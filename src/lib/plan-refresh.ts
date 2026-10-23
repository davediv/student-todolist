import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { isOnline } from "./offline";
import { prepareOfflineCache, reconcileSession } from "./offline-cache";

/** One owner for cookie verification followed by a single active-query refresh. */
export function listenForPlanRefresh(
	client: QueryClient,
	routes: {
		signedOut: () => Promise<unknown>;
		invalidate: () => Promise<unknown>;
	},
) {
	let refreshing = false;
	let expired = false;
	function sessionExpired() {
		if (expired) return;
		expired = true;
		void routes.signedOut();
	}
	async function refresh() {
		onlineManager.setOnline(isOnline());
		if (!isOnline() || refreshing) return;
		refreshing = true;
		try {
			await prepareOfflineCache(client);
			await reconcileSession(client);
			expired = false;
			await client.invalidateQueries({
				predicate: (query) => query.queryKey[0] !== "session",
			});
			await routes.invalidate();
		} catch {
			/* Keep saved data during a network interruption; the next event retries. */
		} finally {
			refreshing = false;
		}
	}
	const refreshOnEvent = () => void refresh();
	const offline = () => onlineManager.setOnline(false);
	const visibility = () => {
		if (document.visibilityState === "visible") refreshOnEvent();
	};
	window.addEventListener("student-todo-session-expired", sessionExpired);
	window.addEventListener("online", refreshOnEvent);
	window.addEventListener("offline", offline);
	window.addEventListener("focus", refreshOnEvent);
	document.addEventListener("visibilitychange", visibility);
	return () => {
		window.removeEventListener("student-todo-session-expired", sessionExpired);
		window.removeEventListener("online", refreshOnEvent);
		window.removeEventListener("offline", offline);
		window.removeEventListener("focus", refreshOnEvent);
		document.removeEventListener("visibilitychange", visibility);
	};
}
