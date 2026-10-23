import { QueryClient } from "@tanstack/react-query";
import { onUnauthorized } from "#/lib/api-client";
import {
	clearOfflineData,
	offlineCacheMaxAge,
	prepareOfflineCache,
} from "#/lib/offline-cache";

export function getContext() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				refetchOnWindowFocus: "always",
				refetchOnReconnect: "always",
				gcTime: offlineCacheMaxAge,
			},
			mutations: { networkMode: "always", retry: false },
		},
	});
	if (typeof window !== "undefined")
		onUnauthorized(() => {
			clearOfflineData(queryClient);
			window.dispatchEvent(new Event("student-todo-session-expired"));
		});
	// The route's beforeLoad awaits the original promise and displays its error.
	void prepareOfflineCache(queryClient).catch(() => undefined);

	return {
		queryClient,
	};
}
export default function TanstackQueryProvider() {}
