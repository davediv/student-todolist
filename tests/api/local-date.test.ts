import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { activityDays, user } from "../../src/db/schema";
import { apiApp, createApiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

it.each([
	undefined,
	"2026-13-40",
	"2026-02-29",
	"2026-04-31",
	"2026-1-01",
	"2026-10-22T00:00:00Z",
])("rejects invalid local date %s after authentication", async (date) => {
	const headers: Record<string, string> = await signedInHeaders();
	delete headers["X-Local-Date"];
	if (date) headers["X-Local-Date"] = date;
	const r = await apiApp.request("/api/me", { headers }, env);
	expect(r.status).toBe(400);
	expect(await r.json()).toMatchObject({
		error: { code: "invalid_local_date" },
	});
	expect(await getDb(env).select().from(activityDays)).toEqual([]);
});
it("exposes the device date rather than the server's date", async () => {
	const app = createApiApp().get("/date", (c) =>
		c.json({ today: c.get("today") }),
	);
	const response = await app.request(
		"/api/date",
		{ headers: await signedInHeaders("student@example.com", "2024-02-29") },
		env,
	);
	expect(await response.json()).toEqual({ today: "2024-02-29" });
});
it("records each user's local day once and cascades deletion", async () => {
	const headers = await signedInHeaders();
	for (let i = 0; i < 10; i++)
		expect((await apiApp.request("/api/me", { headers }, env)).status).toBe(
			200,
		);
	expect(await getDb(env).select().from(activityDays)).toHaveLength(1);
	await apiApp.request(
		"/api/me",
		{ headers: { ...headers, "X-Local-Date": "2026-10-23" } },
		env,
	);
	await apiApp.request(
		"/api/me",
		{ headers: await signedInHeaders("friend@example.com") },
		env,
	);
	expect(await getDb(env).select().from(activityDays)).toHaveLength(3);
	const [student] = await getDb(env)
		.select()
		.from(user)
		.where(eq(user.email, "student@example.com"));
	await getDb(env).delete(user).where(eq(user.id, student.id));
	expect(await getDb(env).select().from(activityDays)).toHaveLength(1);
});
it("keeps public endpoints header-free", async () => {
	expect((await apiApp.request("/api/health", {}, env)).status).toBe(200);
	expect((await apiApp.request("/api/auth/get-session", {}, env)).status).toBe(
		200,
	);
	expect(
		(
			await apiApp.request(
				"/api/test/sign-in?email=student@example.com",
				{},
				env,
			)
		).status,
	).toBe(302);
});
