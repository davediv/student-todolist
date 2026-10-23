/* The build replaces these values after prerendering the SPA shell. */
const CACHE_PREFIX = "student-todo-shell-";
const CACHE_NAME = `${CACHE_PREFIX}__BUILD_VERSION__`;
const PRECACHE_URLS = [/* __PRECACHE_URLS__ */];
const PRECACHE_PATHS = new Set(PRECACHE_URLS);

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(async (cache) => {
			await cache.addAll(
				PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })),
			);
			await self.skipWaiting();
		}),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names
						.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
						.map((name) => caches.delete(name)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (
		request.method !== "GET" ||
		url.origin !== self.location.origin ||
		url.pathname === "/api" ||
		url.pathname.startsWith("/api/")
	) {
		return;
	}
	if (request.mode === "navigate") {
		event.respondWith(
			caches.open(CACHE_NAME).then(async (cache) => {
				const shell = await cache.match("/_shell.html");
				// Cloudflare redirects /_shell.html to /_shell. Navigations reject
				// redirected cached responses, so remove the redirect metadata.
				if (shell?.redirected) {
					return new Response(shell.body, {
						status: shell.status,
						statusText: shell.statusText,
						headers: shell.headers,
					});
				}
				return shell || fetch(request);
			}),
		);
	} else if (PRECACHE_PATHS.has(url.pathname) && !url.search) {
		event.respondWith(
			caches.open(CACHE_NAME).then(async (cache) => {
				return (await cache.match(request)) || fetch(request);
			}),
		);
	}
});
