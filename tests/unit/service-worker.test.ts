import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const origin = "https://student.example";
const urls = ["/_shell.html", "/assets/app-a1b2.js", "/manifest.webmanifest"];
const source = (await readFile("public/sw.js", "utf8"))
	.replace("__BUILD_VERSION__", "current")
	.replace("[/* __PRECACHE_URLS__ */]", JSON.stringify(urls));

function worker() {
	const listeners = new Map<string, (event: unknown) => void>();
	const cache = {
		addAll: vi.fn().mockResolvedValue(undefined),
		match: vi.fn(),
	};
	const caches = {
		open: vi.fn().mockResolvedValue(cache),
		keys: vi.fn().mockResolvedValue([]),
		delete: vi.fn().mockResolvedValue(true),
	};
	const self = {
		location: { origin },
		addEventListener: (name: string, listener: (event: unknown) => void) =>
			listeners.set(name, listener),
		skipWaiting: vi.fn().mockResolvedValue(undefined),
		clients: { claim: vi.fn().mockResolvedValue(undefined) },
	};
	const fetch = vi.fn().mockRejectedValue(new Error("Offline"));
	runInNewContext(source, {
		self,
		caches,
		fetch,
		URL,
		Response,
		Request: class extends Request {
			constructor(url: string, options?: RequestInit) {
				super(new URL(url, origin), options);
			}
		},
	});
	return { listeners, cache, caches, self, fetch };
}

describe("app shell service worker", () => {
	it("installs the complete static build before taking over", async () => {
		const { listeners, cache, self } = worker();
		const waitUntil = vi.fn();
		listeners.get("install")?.({ waitUntil });
		await waitUntil.mock.calls[0][0];
		const requests = cache.addAll.mock.calls[0][0] as Request[];
		expect(requests.map((request) => new URL(request.url).pathname)).toEqual(
			urls,
		);
		expect(requests.every((request) => request.cache === "reload")).toBe(true);
		expect(self.skipWaiting).toHaveBeenCalledOnce();
	});

	it("keeps the old worker if any new precache download fails", async () => {
		const { listeners, cache, self } = worker();
		cache.addAll.mockRejectedValue(new Error("Missing chunk"));
		const waitUntil = vi.fn();
		listeners.get("install")?.({ waitUntil });
		await expect(waitUntil.mock.calls[0][0]).rejects.toThrow("Missing chunk");
		expect(self.skipWaiting).not.toHaveBeenCalled();
	});

	it("removes only outdated app shell caches and claims clients", async () => {
		const { listeners, caches, self } = worker();
		caches.keys.mockResolvedValue([
			"student-todo-shell-old",
			"student-todo-shell-current",
			"other-app",
		]);
		const waitUntil = vi.fn();
		listeners.get("activate")?.({ waitUntil });
		await waitUntil.mock.calls[0][0];
		expect(caches.delete.mock.calls).toEqual([["student-todo-shell-old"]]);
		expect(self.clients.claim).toHaveBeenCalledOnce();
	});

	it("answers a navigation with the cached SPA shell without a network", async () => {
		const { listeners, cache, fetch } = worker();
		const shell = new Response("<html>App shell</html>");
		cache.match.mockResolvedValue(shell);
		const respondWith = vi.fn();
		listeners.get("fetch")?.({
			request: { url: `${origin}/upcoming`, method: "GET", mode: "navigate" },
			respondWith,
		});
		expect(await respondWith.mock.calls[0][0]).toBe(shell);
		expect(cache.match).toHaveBeenCalledWith("/_shell.html");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("serves a precached hashed asset", async () => {
		const { listeners, cache, fetch } = worker();
		const asset = new Response("export default 'app';");
		cache.match.mockResolvedValue(asset);
		const request = new Request(`${origin}/assets/app-a1b2.js`);
		const respondWith = vi.fn();
		listeners.get("fetch")?.({ request, respondWith });
		expect(await respondWith.mock.calls[0][0]).toBe(asset);
		expect(cache.match).toHaveBeenCalledWith(request);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("normalizes Cloudflare's redirected shell for navigation responses", async () => {
		const { listeners, cache } = worker();
		const shell = new Response("<html>App shell</html>", {
			headers: { "Content-Type": "text/html" },
		});
		Object.defineProperty(shell, "redirected", { value: true });
		cache.match.mockResolvedValue(shell);
		const respondWith = vi.fn();
		listeners.get("fetch")?.({
			request: { url: `${origin}/upcoming`, method: "GET", mode: "navigate" },
			respondWith,
		});
		const response = (await respondWith.mock.calls[0][0]) as Response;
		expect(response.redirected).toBe(false);
		expect(response.headers.get("Content-Type")).toBe("text/html");
		expect(await response.text()).toBe("<html>App shell</html>");
	});

	it.each([
		["/api", "GET", "navigate"],
		["/api/days?from=2026-10-23", "GET", "cors"],
		["/api/auth/callback/google", "GET", "navigate"],
		["/api/todos", "POST", "cors"],
		["/other-data.json", "GET", "cors"],
		["/assets/app-a1b2.js?private=true", "GET", "cors"],
		["https://other.example/assets/app-a1b2.js", "GET", "cors"],
	])("does not intercept %s (%s)", (path, method, mode) => {
		const { listeners, caches } = worker();
		const respondWith = vi.fn();
		listeners.get("fetch")?.({
			request: { url: new URL(path, origin).href, method, mode },
			respondWith,
		});
		expect(respondWith).not.toHaveBeenCalled();
		expect(caches.open).not.toHaveBeenCalled();
	});
});
