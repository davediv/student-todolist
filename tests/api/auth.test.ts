import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { session, user } from "../../src/db/schema";
import { getAuth } from "../../src/lib/auth";
import { guestEmail } from "../../src/lib/guest";
import { apiApp, createApiApp } from "../../src/server/api";

const email = "student@example.com";
async function signIn(bindings = env, address = email) {
	const result = await apiApp.request(
		`${bindings.BETTER_AUTH_URL}/api/test/sign-in?email=${address}`,
		{},
		bindings,
	);
	return {
		result,
		cookie: result.headers.get("set-cookie")?.split(";")[0] ?? "",
	};
}
it("protects me and future API routes", async () => {
	for (const path of ["/api/me", "/api/future"]) {
		const r = await createApiApp()
			.get("/future", (c) => c.json({ secret: true }))
			.request(path, {}, env);
		expect(r.status).toBe(401);
		expect(await r.json()).toMatchObject({
			error: { code: "unauthenticated" },
		});
	}
});
it("creates a user and a real HttpOnly session through the shared hooks", async () => {
	const { result, cookie } = await signIn();
	expect(result.status).toBe(302);
	expect(result.headers.get("location")).toBe("/");
	expect(result.headers.get("set-cookie")).toMatch(/HttpOnly/i);
	expect(result.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
	const me = await apiApp.request(
		"/api/me",
		{ headers: { cookie, "X-Local-Date": "2026-10-22" } },
		env,
	);
	expect(me.status).toBe(200);
	expect(await me.json()).toMatchObject({
		id: expect.any(String),
		name: "student",
		email,
		image: null,
	});
	const again = await signIn();
	expect(again.result.status).toBe(302);
	expect(await getDb(env).select().from(user)).toHaveLength(1);
});
it("rejects non-allowlisted emails without creating a user", async () => {
	const { result } = await signIn(env, "outsider@example.com");
	expect(result.status).toBe(403);
	expect(await result.json()).toEqual({
		error: { code: "not_allowlisted", message: "This app is invite-only" },
	});
	expect(await getDb(env).select().from(user)).toHaveLength(0);
});
it("checks existing accounts and case-insensitive lists on every sign-in", async () => {
	expect(
		(await signIn({ ...env, ALLOWED_EMAILS: " STUDENT@EXAMPLE.COM " })).result
			.status,
	).toBe(302);
	expect(
		(await signIn({ ...env, ALLOWED_EMAILS: "friend@example.com" })).result
			.status,
	).toBe(403);
	const context = await getAuth({
		...env,
		ALLOWED_EMAILS: "friend@example.com",
	}).$context;
	const [student] = await getDb(env).select().from(user);
	await expect(
		context.internalAdapter.createSession(student.id),
	).rejects.toMatchObject({ status: "FORBIDDEN" });
});
it("allowlists the local guest account outside production only", async () => {
	const { result } = await signIn(env, guestEmail);
	expect(result.status).toBe(302);
	const guest = await getDb(env).query.user.findFirst({
		where: eq(user.email, guestEmail),
	});
	expect(guest).toBeDefined();
	const production = await getAuth({ ...env, ENVIRONMENT: "production" })
		.$context;
	await expect(
		production.internalAdapter.createSession(guest?.id ?? ""),
	).rejects.toMatchObject({ status: "FORBIDDEN" });
});
it("does not register either test sign-in path in production", async () => {
	for (const path of [
		"/api/test/sign-in?email=student@example.com",
		"/api/auth/test-sign-in?email=student@example.com",
	]) {
		expect(
			(await apiApp.request(path, {}, { ...env, ENVIRONMENT: "production" }))
				.status,
		).toBe(404);
	}
});
it("disables password endpoints", async () => {
	for (const path of ["sign-up/email", "sign-in/email"]) {
		expect(
			(
				await apiApp.request(
					`/api/auth/${path}`,
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							origin: env.BETTER_AUTH_URL,
						},
						body: JSON.stringify({
							email,
							password: "password123",
							name: "Student",
						}),
					},
					env,
				)
			).status,
		).toBe(404);
	}
});
it("uses Secure cookies on HTTPS", async () => {
	const { result, cookie } = await signIn({
		...env,
		BETTER_AUTH_URL: "https://student.example",
	});
	expect(result.status).toBe(302);
	expect(result.headers.get("set-cookie")).toMatch(/; Secure/i);
	expect(
		(
			await apiApp.request(
				"https://student.example/api/me",
				{ headers: { cookie, "X-Local-Date": "2026-10-22" } },
				{ ...env, BETTER_AUTH_URL: "https://student.example" },
			)
		).status,
	).toBe(200);
});
it("signs out and invalidates the session", async () => {
	const { cookie } = await signIn();
	const response = await apiApp.request(
		"/api/auth/sign-out",
		{ method: "POST", headers: { cookie, origin: env.BETTER_AUTH_URL } },
		env,
	);
	expect(response.status).toBe(200);
	expect(
		(
			await apiApp.request(
				"/api/me",
				{ headers: { cookie, "X-Local-Date": "2026-10-22" } },
				env,
			)
		).status,
	).toBe(401);
});
it("starts Google OAuth with the configured callback URI", async () => {
	const response = await apiApp.request(
		`${env.BETTER_AUTH_URL}/api/auth/sign-in/social`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: env.BETTER_AUTH_URL,
			},
			body: JSON.stringify({
				provider: "google",
				callbackURL: "/",
				errorCallbackURL: "/sign-in",
			}),
		},
		env,
	);
	expect(response.status).toBe(200);
	const data = (await response.json()) as { url: string };
	const url = new URL(data.url);
	expect(url.hostname).toBe("accounts.google.com");
	expect(url.searchParams.get("redirect_uri")).toBe(
		`${env.BETTER_AUTH_URL}/api/auth/callback/google`,
	);
});
it("renews browser cookies as well as database expiry for an aged session", async () => {
	const { cookie } = await signIn();
	const db = getDb(env);
	const day = 86_400_000;
	await db.update(session).set({ expiresAt: new Date(Date.now() + 2 * day) });
	const response = await apiApp.request(
		"/api/me",
		{ headers: { cookie, "X-Local-Date": "2026-10-22" } },
		env,
	);
	expect(response.status).toBe(200);
	expect(response.headers.get("set-cookie")).toContain("session_token=");
	expect(response.headers.get("set-cookie")).toContain("Max-Age=604800");
	const [renewed] = await db.select().from(session);
	expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * day);
});
it("expires the browser cookie when a session has expired", async () => {
	const { cookie } = await signIn();
	await getDb(env)
		.update(session)
		.set({ expiresAt: new Date(Date.now() - 1000) });
	const response = await apiApp.request(
		"/api/me",
		{ headers: { cookie, "X-Local-Date": "2026-10-22" } },
		env,
	);
	expect(response.status).toBe(401);
	expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
});
