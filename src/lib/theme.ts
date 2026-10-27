/** Suppress transitions for one frame when the system theme flips, so colours snap. */
export function snapThemeChanges() {
	const query = window.matchMedia("(prefers-color-scheme: dark)");
	function snap() {
		const root = document.documentElement;
		root.classList.add("theme-switching");
		requestAnimationFrame(() =>
			requestAnimationFrame(() => root.classList.remove("theme-switching")),
		);
	}
	query.addEventListener("change", snap);
	return () => query.removeEventListener("change", snap);
}
