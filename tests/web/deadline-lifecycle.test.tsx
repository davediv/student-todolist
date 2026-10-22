import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeadlineInput } from "../../src/lib/deadlines";
import { deadlinesQueryOptions } from "../../src/lib/deadlines-query";
import { renderRoute } from "./router";

function deadline(
	id: string,
	title: string,
	dueDate = "2026-10-30",
	status: "active" | "done" = "active",
) {
	return {
		id,
		title,
		dueDate,
		status,
		type: "assignment" as DeadlineInput["type"],
		startDate: "2026-10-20",
		estimateMinutes: 360,
		notes: "",
		userId: "student-id",
		doneAt: null,
		createdAt: "2026-10-20T00:00:00Z",
		tickedMinutes: 120,
		plannedMinutes: 300,
		unplannedMinutes: 60,
	};
}
type Summary = ReturnType<typeof deadline>;
type Groups = { pastDue: Summary[]; active: Summary[]; done: Summary[] };
const empty = (): Groups => ({ pastDue: [], active: [], done: [] });
async function list(groups: Groups) {
	const view = await renderRoute("/deadlines");
	act(() =>
		view.queryClient.setQueryData(deadlinesQueryOptions.queryKey, groups),
	);
	await screen.findByText(
		(groups.pastDue[0] ?? groups.active[0] ?? groups.done[0]).title,
	);
	return view;
}
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 26, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("shows Past due first with all three actions, Active next, and Done collapsed", async () => {
	await list({
		pastDue: [deadline("past", "Past essay", "2026-10-25")],
		active: [deadline("active", "Current essay")],
		done: [deadline("done", "Finished essay", "2026-10-24", "done")],
	});
	const past = screen.getByRole("region", { name: "Past due" });
	expect(within(past).getByRole("button", { name: "Mark done" })).toBeVisible();
	expect(
		within(past).getByRole("link", { name: "Extend due date" }),
	).toHaveAttribute("href", "/deadlines/past?edit=true&focusDue=true");
	expect(within(past).getByRole("button", { name: "Delete" })).toBeVisible();
	const active = screen.getByRole("region", { name: "Active" });
	expect(
		past.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	expect(screen.getByText("Finished essay")).not.toBeVisible();
	const summary = screen.getByText("Done (1)");
	expect(summary.tagName).toBe("SUMMARY");
	await userEvent.setup().click(summary);
	expect(screen.getByText("Finished essay")).toBeVisible();
});
it("moves Mark done into the collapsed Done group and refreshes all plan screens", async () => {
	const current = deadline("one", "Essay");
	let groups: Groups = { ...empty(), active: [current] };
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url, options) => {
			if (String(url).endsWith("/done") && options?.method === "POST") {
				groups = { ...empty(), done: [{ ...current, status: "done" }] };
				return new Response(JSON.stringify({ deadline: groups.done[0] }));
			}
			return new Response(JSON.stringify(groups));
		});
	const { queryClient } = await list(groups);
	const invalidation = vi.spyOn(queryClient, "invalidateQueries");
	await userEvent
		.setup()
		.click(screen.getByRole("button", { name: "Mark done" }));
	expect(await screen.findByText("Done (1)")).toBeVisible();
	expect(
		screen.queryByRole("button", { name: "Mark done" }),
	).not.toBeInTheDocument();
	expect(screen.getByText("Essay")).not.toBeVisible();
	expect(
		fetcher.mock.calls.some(
			([url, options]) =>
				String(url) === "/api/deadlines/one/done" && options?.method === "POST",
		),
	).toBe(true);
	expect(
		invalidation.mock.calls.map(([options]) => options?.queryKey?.[0]),
	).toEqual(
		expect.arrayContaining(["days", "deadlines", "deadline", "overdue"]),
	);
});
it("confirms deletion, Cancel keeps the deadline, and Confirm removes it", async () => {
	const current = deadline("one", "Essay");
	let groups: Groups = { ...empty(), active: [current] };
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (_url, options) => {
			if (options?.method === "DELETE") {
				groups = empty();
				return new Response(JSON.stringify({ deleted: "one" }));
			}
			return new Response(JSON.stringify(groups));
		});
	await list(groups);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Delete" }));
	expect(
		await screen.findByRole("dialog", { name: "Delete Essay?" }),
	).toBeVisible();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.getByRole("heading", { name: "Essay" })).toBeVisible();
	expect(fetcher).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Delete" }));
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	expect(
		await screen.findByText("No deadlines yet — add one to get a plan"),
	).toBeVisible();
	expect(
		fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE"),
	).toHaveLength(1);
});
it("keeps the deadline visible after a failed Mark done and allows retry", async () => {
	const current = deadline("one", "Essay");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response("{}", { status: 500 }),
	);
	await list({ ...empty(), active: [current] });
	await userEvent
		.setup()
		.click(screen.getByRole("button", { name: "Mark done" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't mark done — try again",
	);
	expect(screen.getByRole("heading", { name: "Essay" })).toBeVisible();
	expect(screen.getByRole("button", { name: "Mark done" })).toBeEnabled();
});
it("deletes from detail, clears its cached query, and navigates without fetching the removed deadline", async () => {
	const current = deadline("one", "Essay");
	let deleted = false;
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url, options) => {
			if (options?.method === "DELETE") {
				deleted = true;
				return new Response(JSON.stringify({ deleted: "one" }));
			}
			if (String(url) === "/api/deadlines")
				return new Response(JSON.stringify(empty()));
			if (deleted) throw new Error("Refetched removed deadline");
			return new Response(JSON.stringify({ deadline: current, sessions: [] }));
		});
	const { queryClient, router } = await renderRoute("/deadlines/one");
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Delete" }));
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	expect(
		await screen.findByRole("heading", { name: "Deadlines" }),
	).toBeVisible();
	await waitFor(() =>
		expect(router.state.location.pathname).toBe("/deadlines"),
	);
	expect(queryClient.getQueryData(["deadline", "one"])).toBeUndefined();
	expect(
		fetcher.mock.calls.filter(
			([url, options]) =>
				String(url) === "/api/deadlines/one" &&
				(!options?.method || options.method === "GET"),
		),
	).toHaveLength(1);
});
it("extends a past-due deadline through the focused edit flow and a fresh preview", async () => {
	let current = deadline("past", "Past essay", "2026-10-25");
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url, options) => {
			if (String(url).endsWith("/preview"))
				return new Response(
					JSON.stringify({
						sessions: [{ date: "2026-10-27", minutes: 180 }],
						keptSessions: [],
						shortfallMinutes: 0,
					}),
				);
			if (options?.method === "PATCH")
				current = {
					...current,
					...(JSON.parse(options.body as string) as DeadlineInput),
				};
			if (String(url) === "/api/deadlines")
				return new Response(JSON.stringify({ ...empty(), active: [current] }));
			return new Response(JSON.stringify({ deadline: current, sessions: [] }));
		});
	await list({ ...empty(), pastDue: [current] });
	const user = userEvent.setup();
	await user.click(screen.getByRole("link", { name: "Extend due date" }));
	const due = await screen.findByLabelText("Due date");
	expect(due).toHaveFocus();
	fireEvent.change(due, { target: { value: "2026-10-30" } });
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(
		await screen.findByRole("heading", { name: "Plan preview" }),
	).toBeVisible();
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(
			screen.queryByRole("heading", { name: "Edit deadline" }),
		).not.toBeInTheDocument(),
	);
	await user.click(screen.getByRole("link", { name: "← Deadlines" }));
	expect(await screen.findByRole("region", { name: "Active" })).toBeVisible();
	expect(
		screen.queryByRole("region", { name: "Past due" }),
	).not.toBeInTheDocument();
	expect(
		fetcher.mock.calls.map(([url, options]) => [String(url), options?.method]),
	).toEqual(
		expect.arrayContaining([
			["/api/deadlines/past/preview", "POST"],
			["/api/deadlines/past", "PATCH"],
		]),
	);
});
