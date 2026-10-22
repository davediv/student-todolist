import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "#/db";
import { activityDays } from "#/db/schema";
import { type AuthUser, getAuth } from "#/lib/auth";
export function createApiApp() {
	const app = new Hono<{
		Bindings: Env;
		Variables: { user: AuthUser; today: string };
	}>().basePath("/api");
	app.notFound((c) =>
		c.json({ error: { code: "not_found", message: "Route not found" } }, 404),
	);
	app.onError((error, c) => {
		console.error(error.stack ?? error);
		return c.json(
			{ error: { code: "internal", message: "Something went wrong" } },
			500,
		);
	});
	app.use("*", async (c, next) => {
		c.header("Cache-Control", "no-store");
		const path = c.req.path;
		if (
			path === "/api/health" ||
			path.startsWith("/api/auth/") ||
			path.startsWith("/api/test/")
		)
			return next();
		const { response: session, headers } = await getAuth(c.env).api.getSession({
			headers: c.req.raw.headers,
			returnHeaders: true,
		});
		for (const cookie of headers.getSetCookie())
			c.header("Set-Cookie", cookie, { append: true });
		if (!session)
			return c.json(
				{ error: { code: "unauthenticated", message: "Please sign in" } },
				401,
			);
		c.set("user", session.user);
		const date = z.iso.date().safeParse(c.req.header("X-Local-Date"));
		if (!date.success)
			return c.json(
				{
					error: {
						code: "invalid_local_date",
						message: "Send a valid X-Local-Date (YYYY-MM-DD)",
					},
				},
				400,
			);
		c.set("today", date.data);
		await getDb(c.env)
			.insert(activityDays)
			.values({ userId: session.user.id, date: date.data })
			.onConflictDoNothing();
		return next();
	});
	app.on(["GET", "POST"], "/auth/*", (c) => getAuth(c.env).handler(c.req.raw));
	app.get("/test/sign-in", async (c) => {
		if (c.env.ENVIRONMENT === "production") return c.notFound();
		const url = new URL(c.req.url);
		url.pathname = "/api/auth/test-sign-in";
		const response = await getAuth(c.env).handler(new Request(url, c.req.raw));
		if (response.status === 403)
			return c.json(
				{
					error: {
						code: "not_allowlisted",
						message: "This app is invite-only",
					},
				},
				403,
			);
		return response;
	});
	return app
		.get("/health", (c) => c.json({ ok: true }))
		.get("/me", (c) => {
			const { id, name, email, image } = c.get("user");
			return c.json({ id, name, email, image: image ?? null });
		});
}
export const apiApp = createApiApp();
export type AppType = typeof apiApp;
