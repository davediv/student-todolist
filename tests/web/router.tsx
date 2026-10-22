import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { sessionQueryOptions } from "../../src/lib/session";
import { Route as root } from "../../src/routes/__root";
import { Route as app } from "../../src/routes/_app";
import { Route as deadlines } from "../../src/routes/_app.deadlines";
import { Route as index } from "../../src/routes/_app.index";
import { Route as settings } from "../../src/routes/_app.settings";
import { Route as upcoming } from "../../src/routes/_app.upcoming";
import { Route as signIn } from "../../src/routes/sign-in";
export const student = {
	id: "student-id",
	name: "Student",
	email: "student@example.com",
	image: null,
};
// The document shell belongs to full browser tests, not a jsdom div.
Object.assign(root.options, {
	shellComponent: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
});
// Use real page routes while excluding server-only API route modules.
const appRoute = app.update({
	id: "/_app",
	getParentRoute: () => root,
} as never);
const routeTree = root.addChildren([
	signIn.update({
		id: "/sign-in",
		path: "/sign-in",
		getParentRoute: () => root,
	} as never),
	appRoute.addChildren([
		index.update({
			id: "/",
			path: "/",
			getParentRoute: () => appRoute,
		} as never),
		upcoming.update({
			id: "/upcoming",
			path: "/upcoming",
			getParentRoute: () => appRoute,
		} as never),
		deadlines.update({
			id: "/deadlines",
			path: "/deadlines",
			getParentRoute: () => appRoute,
		} as never),
		settings.update({
			id: "/settings",
			path: "/settings",
			getParentRoute: () => appRoute,
		} as never),
	]),
]);
export async function renderRoute(
	path = "/",
	user: typeof student | null = student,
	updatedAt = Date.now(),
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(sessionQueryOptions.queryKey, user, { updatedAt });
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
