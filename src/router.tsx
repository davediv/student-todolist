import { onlineManager } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { SkeletonRows } from "#/components/shared/skeleton";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { isOnline } from "./lib/offline";
import { reconcileSession, waitForOfflineCache } from "./lib/offline-cache";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const context = getContext();

	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPendingComponent: SkeletonRows,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });
	if (typeof window !== "undefined") {
		let refreshing = false;
		let expired = false;
		window.addEventListener("student-todo-session-expired", () => {
			if (expired) return;
			expired = true;
			void router.navigate({ to: "/sign-in", replace: true });
		});
		const refresh = async () => {
			onlineManager.setOnline(isOnline());
			if (!isOnline() || refreshing) return;
			refreshing = true;
			try {
				await waitForOfflineCache(context.queryClient);
				await reconcileSession(context.queryClient);
				expired = false;
				await context.queryClient.invalidateQueries();
				await router.invalidate();
			} catch {
				/* Keep the saved plan available during a network interruption. */
			} finally {
				refreshing = false;
			}
		};
		window.addEventListener("online", () => void refresh());
		window.addEventListener("offline", () => onlineManager.setOnline(false));
		window.addEventListener("focus", () => void refresh());
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") void refresh();
		});
	}

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
