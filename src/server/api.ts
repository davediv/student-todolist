import { Hono } from "hono";
export function createApiApp() {
	const app = new Hono<{ Bindings: Env }>().basePath("/api");
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
	return app.get("/health", (c) => c.json({ ok: true }));
}
export const apiApp = createApiApp();
export type AppType = typeof apiApp;
