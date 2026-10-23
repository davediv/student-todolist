import { onlineManager, QueryClient } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getContext } from "../../src/integrations/tanstack-query/root-provider";
import { createApiClient, onUnauthorized } from "../../src/lib/api-client";
import { authClient } from "../../src/lib/auth-client";
import { defaultLimits } from "../../src/lib/limits";
import { offlineHint } from "../../src/lib/offline";
import {
	clearOfflineData,
	offlineCacheKey,
	prepareOfflineCache,
	reconcileSession,
	waitForOfflineCache,
} from "../../src/lib/offline-cache";
import { listenForPlanRefresh } from "../../src/lib/plan-refresh";
import { addDays } from "../../src/lib/planner";
import { recentWeeks } from "../../src/lib/week";
import { renderQueryClientRoute, renderRoute, student } from "./router";

vi.mock("../../src/lib/auth-client", () => ({
	authClient: { signIn: { social: vi.fn() }, signOut: vi.fn() },
}));

const today = "2026-10-26";
const clients: QueryClient[] = [];
const subscriptions: (() => void)[] = [];
function online(value: boolean) {
	Object.defineProperty(navigator, "onLine", { configurable: true, value });
	onlineManager.setOnline(value);
	window.dispatchEvent(new Event(value ? "online" : "offline"));
}
function client() {
	const value = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				refetchOnReconnect: false,
				refetchOnWindowFocus: false,
			},
		},
	});
	clients.push(value);
	return value;
}
function seed(value: QueryClient) {
	value.setQueryData(["session"], student);
	value.setQueryData(["limits"], defaultLimits);
	const session = {
		id: "session",
		userId: student.id,
		deadlineId: "essay",
		date: today,
		minutes: 120,
		ticked: false,
		tickedAt: null,
		title: "Cached essay",
		type: "assignment",
		dueDate: "2026-10-30",
	};
	const todo = {
		id: "todo",
		userId: student.id,
		title: "Cached errand",
		date: null,
		done: false,
		doneAt: null,
	};
	const day = {
		date: today,
		isDayOff: false,
		limitMinutes: 180,
		plannedMinutes: 120,
		overLimit: false,
		sessions: [session],
		todos: [],
	};
	value.setQueryData(["days", today, today], { days: [day], anytime: [todo] });
	value.setQueryData(["days", addDays(today, 1), addDays(today, 14)], {
		days: [{ ...day, date: addDays(today, 1) }],
		anytime: [],
	});
	value.setQueryData(["overdue", today], {
		sessions: [
			{
				...session,
				id: "late",
				title: "Cached overdue essay",
				date: addDays(today, -1),
			},
		],
		todos: [],
	});
	value.setQueryData(["days-off", today], []);
	value.setQueryData(["deadlines"], { active: [], pastDue: [], done: [] });
	value.setQueryData(["stats", "weekly", today], {
		weeks: recentWeeks(today).map((week) => ({
			...week,
			doneMinutes: 120,
			plannedMinutes: 180,
		})),
	});
}
async function savedClient() {
	const value = client();
	await prepareOfflineCache(value);
	seed(value);
	await waitFor(() =>
		expect(localStorage.getItem(offlineCacheKey)).toContain("Cached essay"),
	);
	return value;
}
beforeEach(() => {
	vi.mocked(authClient.signOut).mockResolvedValue({
		data: { success: true },
		error: null,
	});
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 26, 12));
	localStorage.clear();
	online(false);
});
afterEach(() => {
	cleanup();
	for (const stop of subscriptions.splice(0)) stop();
	for (const value of clients.splice(0)) value.clear();
	localStorage.clear();
	onUnauthorized(() => {});
	vi.restoreAllMocks();
	vi.useRealTimers();
	online(true);
});

it("restores Today and Upcoming before offline route guards without a network request", async () => {
	await savedClient();
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Offline"));
	const restored = client();
	const restoring = prepareOfflineCache(restored);
	const view = await renderQueryClientRoute(restored);
	await restoring;
	expect(await screen.findByRole("heading", { name: "Today" })).toBeVisible();
	expect(screen.getByRole("status")).toHaveTextContent(
		`Offline · ${offlineHint}`,
	);
	expect(
		screen.getByRole("checkbox", { name: "Cached essay, 2h" }),
	).toBeDisabled();
	await userEvent.click(screen.getByRole("link", { name: "Upcoming" }));
	expect(
		await screen.findByRole("heading", { name: "Upcoming" }),
	).toBeVisible();
	expect(
		screen.getByRole("checkbox", { name: "Cached essay, 2h" }),
	).toBeDisabled();
	expect(view.router.state.location.pathname).toBe("/upcoming");
	expect(fetcher).not.toHaveBeenCalled();
});

it("persists plan/profile data only, excluding auth payloads and paused mutations", async () => {
	const value = await savedClient();
	value.setQueryData(["auth", "tokens"], { accessToken: "SECRET_TOKEN" });
	value.getMutationCache().build(
		value,
		{ mutationKey: ["queued"], mutationFn: async () => {} },
		{
			context: undefined,
			data: undefined,
			error: null,
			failureCount: 0,
			failureReason: null,
			isPaused: true,
			status: "pending",
			variables: "SECRET_MUTATION",
			submittedAt: Date.now(),
		},
	);
	const saved = JSON.parse(localStorage.getItem(offlineCacheKey) ?? "{}");
	expect(saved.clientState.mutations).toEqual([]);
	expect(
		saved.clientState.queries.map(
			(query: { queryKey: string[] }) => query.queryKey[0],
		),
	).not.toContain("auth");
	expect(JSON.stringify(saved)).not.toContain("SECRET");
});

it("disables every Today write action but keeps navigation and the weekly history usable", async () => {
	const value = await savedClient();
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Offline"));
	await renderQueryClientRoute(value);
	for (const name of [
		/^Add$/,
		/^Session actions/,
		/^Edit Cached errand$/,
		/^Delete Cached errand$/,
		/^Re-plan$/,
	]) {
		for (const button of screen.getAllByRole("button", { name }))
			expect(button).toBeDisabled();
	}
	for (const checkbox of screen.getAllByRole("checkbox"))
		expect(checkbox).toBeDisabled();
	await userEvent.click(screen.getByRole("button", { name: "Add" }));
	await userEvent.click(
		screen.getByRole("checkbox", { name: "Cached essay, 2h" }),
	);
	expect(fetcher).not.toHaveBeenCalled();
	await userEvent.click(screen.getByRole("link", { name: "Upcoming" }));
	await userEvent.click(
		await screen.findByRole("button", { name: /Show last 4 weeks/ }),
	);
	const dialog = screen.getByRole("dialog", { name: "Last 4 weeks" });
	expect(within(dialog).getAllByRole("progressbar")).toHaveLength(4);
	expect(within(dialog).getByRole("button", { name: "Back" })).toBeEnabled();
	await userEvent.click(within(dialog).getByRole("button", { name: "Back" }));
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each([
	"post",
	"patch",
	"delete",
] as const)("rejects offline %s before calling fetch", async (method) => {
	const fetcher = vi.fn<typeof fetch>();
	const api = createApiClient(fetcher);
	const request =
		method === "post"
			? api.api.todos.$post({ json: { title: "No write", date: null } })
			: method === "patch"
				? api.api.todos[":id"].$patch({
						param: { id: "todo" },
						json: { done: true },
					})
				: api.api.todos[":id"].$delete({ param: { id: "todo" } });
	await expect(request).rejects.toMatchObject({
		code: "offline",
		message: offlineHint,
	});
	expect(fetcher).not.toHaveBeenCalled();
});

it("keeps Cancel active if a form or confirmation was already open when connectivity drops", async () => {
	online(true);
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async () => new Response("[]"),
	);
	const { queryClient } = await renderRoute("/deadlines?add=true");
	clients.push(queryClient);
	await act(async () => online(false));
	expect(screen.getByRole("button", { name: "Preview plan" })).toBeDisabled();
	expect(screen.getByRole("textbox", { name: "Title" })).toBeDisabled();
	expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
	await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.getByRole("button", { name: "+ Deadline" })).toBeDisabled();
});

it("reconciles the current cookie before exposing a different persisted user's plan", async () => {
	await savedClient();
	online(true);
	const other = { ...student, id: "other-student", email: "other@example.com" };
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async () => new Response(JSON.stringify(other)),
	);
	const restored = client();
	await prepareOfflineCache(restored);
	expect(restored.getQueryData(["session"])).toEqual(other);
	expect(restored.getQueryData(["days", today, today])).toBeUndefined();
	expect(restored.getQueryData(["limits"])).toBeUndefined();
	expect(localStorage.getItem(offlineCacheKey) ?? "").not.toContain(
		"Cached essay",
	);
});

it("clears all saved plan data on any authenticated API 401", async () => {
	const { queryClient } = getContext();
	clients.push(queryClient);
	await waitForOfflineCache(queryClient);
	seed(queryClient);
	expect(localStorage.getItem(offlineCacheKey)).toContain("Cached essay");
	online(true);
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValue(new Response("{}", { status: 401 }));
	await expect(
		createApiClient(fetcher).api.deadlines.$get(),
	).rejects.toMatchObject({ status: 401 });
	expect(queryClient.getQueryData(["session"])).toBeNull();
	expect(queryClient.getQueryData(["days", today, today])).toBeUndefined();
	expect(localStorage.getItem(offlineCacheKey)).toBeNull();
});

it("verifies the session and refetches the active plan once per reconnect or focus", async () => {
	const value = await savedClient();
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(
			async (url) =>
				new Response(
					JSON.stringify(
						String(url) === "/api/me"
							? student
							: String(url) === "/api/limits"
								? defaultLimits
								: String(url).includes("/overdue")
									? { sessions: [], todos: [] }
									: { days: [], anytime: [] },
					),
				),
		);
	const view = await renderQueryClientRoute(value);
	subscriptions.push(
		listenForPlanRefresh(value, {
			signedOut: () => view.router.navigate({ to: "/sign-in", replace: true }),
			invalidate: () => view.router.invalidate(),
		}),
	);
	const calls = (path: string) =>
		fetcher.mock.calls.filter(([url]) => String(url).startsWith(path)).length;
	expect(screen.getByRole("status")).toHaveTextContent("Offline");
	await act(async () => online(true));
	await waitFor(() => expect(calls("/api/days?")).toBe(1));
	await waitFor(() => expect(value.isFetching()).toBe(0));
	expect(screen.queryByText(offlineHint)).not.toBeInTheDocument();
	await act(async () => {
		window.dispatchEvent(new Event("focus"));
	});
	await waitFor(() => expect(calls("/api/days?")).toBe(2));
	await waitFor(() => expect(value.isFetching()).toBe(0));
	expect(calls("/api/me")).toBe(2);
});

it("removes persisted data on sign-out and an offline reload has no plan", async () => {
	online(true);
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async () =>
			new Response("{}", { headers: { "content-type": "application/json" } }),
	);
	const view = await renderRoute("/settings");
	clients.push(view.queryClient);
	await act(async () => online(false));
	await prepareOfflineCache(view.queryClient);
	seed(view.queryClient);
	await act(async () => online(true));
	await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
	expect(
		await screen.findByRole("button", { name: "Sign in with Google" }),
	).toBeVisible();
	expect(authClient.signOut).toHaveBeenCalled();
	expect(localStorage.getItem(offlineCacheKey)).toBeNull();
	view.unmount();
	online(false);
	const fresh = client();
	await prepareOfflineCache(fresh);
	await renderQueryClientRoute(fresh);
	expect(
		await screen.findByRole("button", { name: "Sign in with Google" }),
	).toBeDisabled();
	expect(screen.queryByText("Cached essay")).not.toBeInTheDocument();
});

it("shows a missing-cache message without redirecting an offline student with saved limits", async () => {
	const value = client();
	await prepareOfflineCache(value);
	value.setQueryData(["session"], student);
	value.setQueryData(["limits"], defaultLimits);
	await renderQueryClientRoute(value);
	expect(
		await screen.findByRole("heading", { name: "No saved plan for today" }),
	).toBeVisible();
	expect(screen.getByRole("heading", { name: "Today" })).toBeVisible();
});

it("discards corrupt or expired persisted data", async () => {
	localStorage.setItem(offlineCacheKey, "not-json");
	const corrupt = client();
	await prepareOfflineCache(corrupt);
	expect(corrupt.getQueryData(["session"])).toBeUndefined();
	await savedClient();
	const saved = JSON.parse(localStorage.getItem(offlineCacheKey) ?? "{}");
	saved.timestamp = 1;
	localStorage.setItem(offlineCacheKey, JSON.stringify(saved));
	const expired = client();
	await prepareOfflineCache(expired);
	expect(expired.getQueryData(["session"])).toBeUndefined();
	expect(localStorage.getItem(offlineCacheKey)).toBeNull();
});

it("clears persisted data when a saved session expires", async () => {
	const value = await savedClient();
	online(true);
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async () => new Response("{}", { status: 401 }),
	);
	await reconcileSession(value);
	expect(value.getQueryData(["session"])).toBeNull();
	expect(localStorage.getItem(offlineCacheKey)).toBeNull();
	clearOfflineData(value);
	expect(value.getQueryData(["limits"])).toBeUndefined();
});

it("clears persisted plan data after confirming account deletion", async () => {
	const value = await savedClient();
	vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
		if (init?.method === "DELETE") return new Response(null, { status: 204 });
		if (String(url) === "/api/me") return new Response("{}", { status: 401 });
		return new Response(
			JSON.stringify(String(url).includes("days-off") ? [] : defaultLimits),
		);
	});
	await renderQueryClientRoute(value, "/settings");
	await act(async () => online(true));
	await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
	await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
	expect(
		await screen.findByRole("button", { name: "Sign in with Google" }),
	).toBeVisible();
	expect(localStorage.getItem(offlineCacheKey)).toBeNull();
	expect(value.getQueryData(["days", today, today])).toBeUndefined();
});

it("reuses saved day ranges and weekly progress after an offline date rollover", async () => {
	await savedClient();
	vi.setSystemTime(new Date(2026, 9, 27, 12));
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Offline"));
	const restored = client();
	await prepareOfflineCache(restored);
	const view = await renderQueryClientRoute(restored);
	expect(
		await screen.findByRole("checkbox", { name: "Cached essay, 2h" }),
	).toBeDisabled();
	expect(screen.getByText(/Saved plan · 27 Oct 2026/)).toBeVisible();
	expect(screen.queryByText("No saved plan for today")).not.toBeInTheDocument();
	await act(async () => {
		await view.router.navigate({ to: "/upcoming" });
	});
	expect(
		await screen.findByRole("button", { name: /This week 2 \/ 3h/ }),
	).toBeVisible();
	expect(
		screen.getByRole("checkbox", { name: "Cached essay, 2h" }),
	).toBeDisabled();
	expect(screen.getByText(/Saved plan · 27 Oct 2026/)).toBeVisible();
	expect(screen.queryByText("No saved upcoming plan")).not.toBeInTheDocument();
	expect(fetcher).not.toHaveBeenCalled();
});

it("dates older offline snapshots when none of their days match the new date", async () => {
	await savedClient();
	vi.setSystemTime(new Date(2026, 10, 3, 12));
	const restored = client();
	await prepareOfflineCache(restored);
	const view = await renderQueryClientRoute(restored);
	expect(
		await screen.findByRole("checkbox", { name: "Cached essay, 2h" }),
	).toBeDisabled();
	expect(screen.getByText(/Saved plan · 26 Oct 2026/)).toBeVisible();
	await act(async () => {
		await view.router.navigate({ to: "/upcoming" });
	});
	expect(
		await screen.findByRole("button", { name: /Week of 26 Oct 2 \/ 3h/ }),
	).toBeVisible();
	expect(screen.getByText(/Saved plan · 27 Oct 2026/)).toBeVisible();
});

it("retries failed startup verification before showing a restored plan online", async () => {
	await savedClient();
	online(true);
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValueOnce(new TypeError("Temporary network failure"))
		.mockResolvedValue(new Response(JSON.stringify(student)));
	const restored = client();
	await expect(prepareOfflineCache(restored)).rejects.toThrow(
		"Temporary network failure",
	);
	// The root guard's Retry must verify the cookie again, then subscribe persistence.
	await waitForOfflineCache(restored);
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(restored.getQueryData(["session"])).toEqual(student);
	restored.setQueryData(["days", "2026-10-28", "2026-10-28"], {
		days: [],
		anytime: [{ title: "Recovered persistence" }],
	});
	await waitFor(() =>
		expect(localStorage.getItem(offlineCacheKey)).toContain(
			"Recovered persistence",
		),
	);
});

it("shows a saved plan when a new-date request fails before going offline", async () => {
	await savedClient();
	vi.setSystemTime(new Date(2026, 9, 27, 12));
	const restored = client();
	await prepareOfflineCache(restored);
	online(true);
	vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
		if (String(url) === "/api/me") return new Response(JSON.stringify(student));
		if (String(url) === "/api/limits")
			return new Response(JSON.stringify(defaultLimits));
		if (String(url).includes("/overdue"))
			return new Response(JSON.stringify({ sessions: [], todos: [] }));
		return new Response(
			JSON.stringify({
				error: { code: "unavailable", message: "Temporary outage" },
			}),
			{ status: 503 },
		);
	});
	await renderQueryClientRoute(restored);
	expect(
		await screen.findByText("Couldn't load your plan — retry"),
	).toBeVisible();
	await act(async () => online(false));
	expect(
		await screen.findByRole("checkbox", { name: "Cached essay, 2h" }),
	).toBeDisabled();
	expect(screen.getByText(/Saved plan · 27 Oct 2026/)).toBeVisible();
	expect(
		screen.queryByText("Couldn't load your plan — retry"),
	).not.toBeInTheDocument();
});

it("retains the last successful plan through a failed refetch and offline reload", async () => {
	const value = await savedClient();
	await expect(
		value.fetchQuery({
			queryKey: ["days", today, today],
			networkMode: "always",
			retry: false,
			queryFn: async () => {
				throw new Error("Temporary plan failure");
			},
		}),
	).rejects.toThrow("Temporary plan failure");
	await waitFor(() =>
		expect(localStorage.getItem(offlineCacheKey)).toContain("Cached essay"),
	);
	const restored = client();
	await prepareOfflineCache(restored);
	await renderQueryClientRoute(restored);
	expect(
		await screen.findByRole("checkbox", { name: "Cached essay, 2h" }),
	).toBeDisabled();
});
