import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { NotFound, RouteError } from "#/components/shared/route-states";
import { SkeletonRows } from "#/components/shared/skeleton";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { listenForPlanRefresh } from "./lib/plan-refresh";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const context = getContext();

	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPendingComponent: SkeletonRows,
		defaultNotFoundComponent: NotFound,
		notFoundMode: "root",
		defaultErrorComponent: RouteError,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });
	if (typeof window !== "undefined") {
		listenForPlanRefresh(context.queryClient, {
			signedOut: () => router.navigate({ to: "/sign-in", replace: true }),
			invalidate: () => router.invalidate(),
		});
	}

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
