import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { Route as root } from "../../src/routes/__root";
import { Route as index } from "../../src/routes/index";
import { Route as upcoming } from "../../src/routes/upcoming";

// The document shell belongs to full browser tests, not a jsdom div.
Object.assign(root.options, {
	shellComponent: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
});
// Use real page routes while excluding server-only API route modules.
const routeTree = root.addChildren([
	index.update({ id: "/", path: "/", getParentRoute: () => root } as never),
	upcoming.update({
		id: "/upcoming",
		path: "/upcoming",
		getParentRoute: () => root,
	} as never),
]);
export async function renderRoute(path = "/") {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [path] }),
		context: { queryClient },
		defaultPendingMinMs: 0,
	});
	await router.load();
	const view = render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return { ...view, router, queryClient };
}
