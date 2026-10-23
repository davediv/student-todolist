import { useSyncExternalStore } from "react";

export const offlineHint = "You're offline — changes are disabled";

export function isOnline() {
	return typeof navigator === "undefined" || navigator.onLine !== false;
}

function subscribe(listener: () => void) {
	window.addEventListener("online", listener);
	window.addEventListener("offline", listener);
	return () => {
		window.removeEventListener("online", listener);
		window.removeEventListener("offline", listener);
	};
}

export function useOnline() {
	return useSyncExternalStore(subscribe, isOnline, () => true);
}
