import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { apiApp, createApiApp } from "../../src/server/api";

it("serves health inside workerd", async () => {
	const response = await apiApp.request("/api/health", {}, env);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ok: true });
});
it("returns JSON errors and logs the stack", async () => {
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	const app = createApiApp().get("/boom", () => {
		throw new Error("test failure");
	});
	const response = await app.request("/api/boom", {}, env);
	expect(response.status).toBe(500);
	expect(await response.json()).toMatchObject({ error: { code: "internal" } });
	expect(log).toHaveBeenCalledWith(
		expect.stringContaining("Error: test failure"),
	);
	log.mockRestore();
	const missing = await apiApp.request("/api/nope", {}, env);
	expect(missing.status).toBe(404);
	expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
});
