import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { deadlinesQueryOptions } from "../../src/lib/deadlines-query";
import { localDate } from "../../src/lib/format";
import { defaultLimits, type StudyLimits } from "../../src/lib/limits";
import { limitsQueryOptions } from "../../src/lib/limits-query";
import { addDays } from "../../src/lib/planner";
import { sessionQueryOptions } from "../../src/lib/session";
import { Route as root } from "../../src/routes/__root";
import { Route as app } from "../../src/routes/_app";
import { Route as deadlines } from "../../src/routes/_app.deadlines";
import { Route as deadlineDetail } from "../../src/routes/_app.deadlines.$deadlineId";
import { Route as deadlineIndex } from "../../src/routes/_app.deadlines.index";
import { Route as index } from "../../src/routes/_app.index";
import { Route as settings } from "../../src/routes/_app.settings";
import { Route as upcoming } from "../../src/routes/_app.upcoming";
import { Route as signIn } from "../../src/routes/sign-in";
import { Route as welcome } from "../../src/routes/welcome";
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
	welcome.update({
		id: "/welcome",
		path: "/welcome",
		getParentRoute: () => root,
	} as never),
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
		deadlines
			.update({
				id: "/deadlines",
				path: "/deadlines",
				getParentRoute: () => appRoute,
			} as never)
			.addChildren([
				deadlineIndex.update({
					id: "/",
					path: "/",
					getParentRoute: () => deadlines,
				} as never),
				deadlineDetail.update({
					id: "/$deadlineId",
					path: "/$deadlineId",
					getParentRoute: () => deadlines,
				} as never),
			]),
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
	limits: StudyLimits | null = defaultLimits,
	seedDays = true,
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(sessionQueryOptions.queryKey, user, { updatedAt });
	queryClient.setQueryData(limitsQueryOptions.queryKey, limits);
	queryClient.setQueryData(deadlinesQueryOptions.queryKey, {
		pastDue: [],
		active: [],
		done: [],
	});
	queryClient.setQueryDefaults(deadlinesQueryOptions.queryKey, {
		staleTime: Infinity,
	});
	if (seedDays) {
		const today = localDate();
		queryClient.setQueryData(["days-off", today], []);
		queryClient.setQueryDefaults(["days-off"], { staleTime: Infinity });
		queryClient.setQueryData(["overdue", today], { sessions: [], todos: [] });
		queryClient.setQueryDefaults(["overdue"], { staleTime: Infinity });
		const empty = (date: string) => ({
			date,
			isDayOff: false,
			limitMinutes: 180,
			plannedMinutes: 0,
			overLimit: false,
			sessions: [],
			todos: [],
		});
		queryClient.setQueryData(["days", today, today], {
			days: [empty(today)],
			anytime: [],
		});
		queryClient.setQueryData(["days", addDays(today, 1), addDays(today, 14)], {
			days: Array.from({ length: 14 }, (_, i) => empty(addDays(today, i + 1))),
			anytime: [],
		});
		queryClient.setQueryDefaults(["days"], { staleTime: Infinity });
	}
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
