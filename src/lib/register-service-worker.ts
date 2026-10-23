let registrationStarted = false;

export function registerServiceWorker() {
	if (
		!import.meta.env.PROD ||
		!("serviceWorker" in navigator) ||
		registrationStarted
	) {
		return;
	}
	registrationStarted = true;
	// Claiming on the first install needs no reload. An update reloads once so
	// the shell and its hashed assets always come from the same build.
	let controlled = !!navigator.serviceWorker.controller;
	let reloading = false;
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (controlled && !reloading) {
			reloading = true;
			window.location.reload();
		}
		controlled = true;
	});
	void navigator.serviceWorker
		.register("/sw.js", { scope: "/", updateViaCache: "none" })
		.catch((error: unknown) => {
			if (navigator.onLine) {
				console.warn("Student Todo could not register its app shell.", error);
			}
		});
}
