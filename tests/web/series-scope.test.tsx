import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderRoute } from "./router";

const deadline = {
	id: "occ2",
	userId: "student-id",
	seriesId: "series-one" as string | null,
	title: "Problem set",
	type: "assignment",
	dueDate: "2026-10-23",
	startDate: "2026-10-16",
	estimateMinutes: 180,
	notes: "Bring notes",
	status: "active",
	doneAt: null,
	createdAt: "2026-10-14T00:00:00Z",
	tickedMinutes: 60,
	plannedMinutes: 180,
	unplannedMinutes: 0,
};
const previewVersion = { revision: 2, today: "2026-10-14" };
const preview = {
	previewVersion,
	occurrences: [
		{
			id: "occ2",
			title: "Problem set",
			type: "assignment",
			notes: "Bring notes",
			dueDate: "2026-10-23",
			startDate: "2026-10-16",
			estimateMinutes: 240,
			action: "update",
			sessions: [{ date: "2026-10-20", minutes: 180 }],
			keptSessions: [{ id: "ticked", date: "2026-10-16", minutes: 60 }],
			shortfallMinutes: 0,
		},
		{
			id: "new-one",
			title: "Problem set",
			type: "assignment",
			notes: "Bring notes",
			dueDate: "2026-10-30",
			startDate: "2026-10-23",
			estimateMinutes: 240,
			action: "create",
			sessions: [{ date: "2026-10-26", minutes: 180 }],
			keptSessions: [],
			shortfallMinutes: 60,
		},
	],
	removed: [{ id: "occ4", title: "Problem set", dueDate: "2026-11-13" }],
};
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 14, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function mockApi(current = deadline) {
	return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
		const path = String(url);
		if (path.endsWith("/preview"))
			return new Response(
				JSON.stringify(
					path.includes("/series/")
						? preview
						: { sessions: [], keptSessions: [], shortfallMinutes: 0 },
				),
			);
		if (init?.method === "DELETE")
			return new Response(JSON.stringify({ deleted: [current.id] }));
		if (init?.method === "PATCH")
			return new Response(JSON.stringify({ ...preview, deadline: current }));
		if (path === "/api/series/series-one")
			return new Response(
				JSON.stringify({
					series: { id: "series-one", leadDays: 7, endDate: "2026-11-13" },
				}),
			);
		if (path === "/api/deadlines")
			return new Response(
				JSON.stringify({ pastDue: [], active: [], done: [] }),
			);
		return new Response(JSON.stringify({ deadline: current, sessions: [] }));
	});
}
async function openFollowing() {
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Edit" }));
	expect(
		await screen.findByRole("dialog", { name: "Edit recurring deadline" }),
	).toBeVisible();
	await user.click(screen.getByRole("button", { name: "This and following" }));
	await screen.findByRole("heading", { name: "Edit this and following" });
	return user;
}

it("asks the edit scope and routes This occurrence through the existing single-deadline form", async () => {
	const fetcher = mockApi();
	await renderRoute("/deadlines/occ2");
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Edit" }));
	await user.click(
		await screen.findByRole("button", { name: "This occurrence" }),
	);
	expect(
		await screen.findByRole("heading", { name: "Edit deadline" }),
	).toBeVisible();
	await user.clear(screen.getByLabelText("Title"));
	await user.type(screen.getByLabelText("Title"), "Only this occurrence");
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(([, init]) => init?.method === "PATCH"),
		).toBe(true),
	);
	const mutation = fetcher.mock.calls.find(
		([, init]) => init?.method === "PATCH",
	);
	expect(String(mutation?.[0])).toBe("/api/deadlines/occ2");
	expect(JSON.parse(mutation?.[1]?.body as string).title).toBe(
		"Only this occurrence",
	);
	expect(
		fetcher.mock.calls.some(([url]) => String(url).includes("/series/")),
	).toBe(false);
});

it("previews changed fields across following occurrences, keeps completed sessions and shows additions/removals", async () => {
	const fetcher = mockApi();
	await renderRoute("/deadlines/occ2");
	const user = await openFollowing();
	expect(screen.queryByText("Weekdays")).toBeNull();
	fireEvent.change(screen.getByLabelText("Estimate per occurrence (hours)"), {
		target: { value: "4" },
	});
	fireEvent.change(screen.getByLabelText("End date"), {
		target: { value: "2026-11-06" },
	});
	await user.click(screen.getByRole("button", { name: "Preview" }));
	expect(
		await screen.findByRole("heading", { name: "This and following preview" }),
	).toBeVisible();
	expect(screen.getByText("Problem set is 1h short")).toBeVisible();
	expect(screen.getByRole("heading", { name: "Kept sessions" })).toBeVisible();
	expect(screen.getByText(/New occurrence/)).toBeVisible();
	expect(
		screen.getByRole("region", { name: "Removed occurrences" }),
	).toBeVisible();
	const request = fetcher.mock.calls.find(([url]) =>
		String(url).endsWith("/occurrences/occ2/preview"),
	);
	expect(JSON.parse(request?.[1]?.body as string)).toEqual({
		estimateMinutes: 240,
		endDate: "2026-11-06",
	});
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.getByLabelText("Estimate per occurrence (hours)")).toHaveValue(
		4,
	);
	expect(screen.getByLabelText("End date")).toHaveValue("2026-11-06");
	expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(
		false,
	);
	await user.click(screen.getByRole("button", { name: "Preview" }));
	await screen.findByRole("heading", { name: "This and following preview" });
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(
		await screen.findByRole("heading", { name: "Deadlines" }),
	).toBeVisible();
	const save = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH");
	expect(String(save?.[0])).toBe("/api/series/series-one/occurrences/occ2");
	expect(JSON.parse(save?.[1]?.body as string)).toEqual({
		estimateMinutes: 240,
		endDate: "2026-11-06",
		previewVersion,
	});
});

it("requires the scope and one confirmation before deleting this and following", async () => {
	const fetcher = mockApi();
	const { queryClient } = await renderRoute("/deadlines/occ2");
	const invalidate = vi.spyOn(queryClient, "invalidateQueries");
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Delete" }));
	expect(
		await screen.findByRole("dialog", { name: "Delete recurring deadline" }),
	).toBeVisible();
	await user.click(screen.getByRole("button", { name: "This and following" }));
	const dialog = await screen.findByRole("dialog", {
		name: "Delete this and following occurrences?",
	});
	expect(dialog).toHaveTextContent("not Done");
	await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
	expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(
		false,
	);
	await user.click(screen.getByRole("button", { name: "Delete" }));
	await user.click(
		await screen.findByRole("button", { name: "This and following" }),
	);
	await user.click(await screen.findByRole("button", { name: "Confirm" }));
	expect(
		await screen.findByRole("heading", { name: "Deadlines" }),
	).toBeVisible();
	const deletions = fetcher.mock.calls.filter(
		([, init]) => init?.method === "DELETE",
	);
	expect(deletions).toHaveLength(1);
	expect(String(deletions[0][0])).toBe(
		"/api/series/series-one/occurrences/occ2",
	);
	expect(invalidate).toHaveBeenCalledWith({
		queryKey: ["series", "series-one"],
	});
});

it("deletes only the selected occurrence through the ordinary confirmation when that scope is chosen", async () => {
	const fetcher = mockApi();
	await renderRoute("/deadlines/occ2");
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Delete" }));
	await user.click(
		await screen.findByRole("button", { name: "This occurrence" }),
	);
	expect(
		await screen.findByRole("dialog", { name: "Delete Problem set?" }),
	).toBeVisible();
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	expect(
		await screen.findByRole("heading", { name: "Deadlines" }),
	).toBeVisible();
	const deletion = fetcher.mock.calls.find(
		([, init]) => init?.method === "DELETE",
	);
	expect(String(deletion?.[0])).toBe("/api/deadlines/occ2");
});

it("asks scope when extending a past-due occurrence, then focuses the single-occurrence due date", async () => {
	mockApi({ ...deadline, dueDate: "2026-10-13", startDate: "2026-10-06" });
	await renderRoute("/deadlines/occ2?edit=true&focusDue=true");
	expect(
		await screen.findByRole("dialog", { name: "Edit recurring deadline" }),
	).toBeVisible();
	expect(screen.queryByLabelText("Due date")).toBeNull();
	await userEvent
		.setup()
		.click(screen.getByRole("button", { name: "This occurrence" }));
	expect(await screen.findByLabelText("Due date")).toHaveFocus();
});

it("never asks scope for a deadline outside a series", async () => {
	mockApi({ ...deadline, seriesId: null });
	await renderRoute("/deadlines/occ2");
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Edit" }));
	expect(
		await screen.findByRole("heading", { name: "Edit deadline" }),
	).toBeVisible();
	expect(screen.queryByRole("dialog")).toBeNull();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	await user.click(screen.getByRole("button", { name: "Delete" }));
	expect(
		await screen.findByRole("dialog", { name: "Delete Problem set?" }),
	).toBeVisible();
	expect(
		screen.queryByRole("button", { name: "This and following" }),
	).toBeNull();
});

it("reloads a stale scoped preview and requires another Save with the updated version", async () => {
	const fetcher = mockApi();
	let previews = 0;
	let saves = 0;
	let refresh!: (response: Response) => void;
	const normal = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (url, init) => {
		if (String(url).endsWith("/occurrences/occ2/preview")) {
			previews++;
			return previews === 1
				? new Response(JSON.stringify(preview))
				: new Promise<Response>((resolve) => {
						refresh = resolve;
					});
		}
		if (init?.method === "PATCH") {
			saves++;
			if (saves === 1)
				return new Response(
					JSON.stringify({
						error: { code: "plan_changed", message: "Your plan changed" },
					}),
					{ status: 409 },
				);
		}
		return normal?.(url, init) as Promise<Response>;
	});
	await renderRoute("/deadlines/occ2");
	const user = await openFollowing();
	fireEvent.change(screen.getByLabelText("Estimate per occurrence (hours)"), {
		target: { value: "4" },
	});
	await user.click(screen.getByRole("button", { name: "Preview" }));
	await screen.findByRole("heading", { name: "This and following preview" });
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(
		await screen.findByText("Your plan changed. Review the updated preview."),
	).toBeVisible();
	expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
	const next = { revision: 3, today: "2026-10-14" };
	refresh(new Response(JSON.stringify({ ...preview, previewVersion: next })));
	await screen.findByRole("button", { name: "Save" });
	expect(saves).toBe(1);
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(
		await screen.findByRole("heading", { name: "Deadlines" }),
	).toBeVisible();
	const mutations = fetcher.mock.calls.filter(
		([, init]) => init?.method === "PATCH",
	);
	expect(JSON.parse(mutations[0][1]?.body as string).previewVersion).toEqual(
		previewVersion,
	);
	expect(JSON.parse(mutations[1][1]?.body as string).previewVersion).toEqual(
		next,
	);
});

it("loads fresh series settings before opening and keeps the draft baseline stable during background refreshes", async () => {
	const fetcher = mockApi();
	const normal = fetcher.getMockImplementation();
	let load!: (response: Response) => void;
	let freshEnd = "2026-11-19";
	let initialLoad = true;
	fetcher.mockImplementation(async (url, init) => {
		if (String(url) === "/api/series/series-one") {
			if (initialLoad)
				return new Promise<Response>((resolve) => {
					load = resolve;
				});
			return new Response(
				JSON.stringify({
					series: { id: "series-one", leadDays: 7, endDate: freshEnd },
				}),
			);
		}
		return normal?.(url, init) as Promise<Response>;
	});
	const { queryClient } = await renderRoute("/deadlines/occ2");
	queryClient.setQueryData(["series", "series-one"], {
		series: { id: "series-one", leadDays: 7, endDate: "2026-11-20" },
	});
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Edit" }));
	await user.click(
		await screen.findByRole("button", { name: "This and following" }),
	);
	expect(screen.queryByLabelText("End date")).toBeNull();
	initialLoad = false;
	load(
		new Response(
			JSON.stringify({
				series: { id: "series-one", leadDays: 7, endDate: freshEnd },
			}),
		),
	);
	expect(await screen.findByLabelText("End date")).toHaveValue("2026-11-19");
	fireEvent.change(screen.getByLabelText("Estimate per occurrence (hours)"), {
		target: { value: "4" },
	});
	freshEnd = "2026-11-18";
	await act(async () => {
		await queryClient.invalidateQueries({ queryKey: ["series", "series-one"] });
	});
	expect(screen.getByLabelText("End date")).toHaveValue("2026-11-19");
	expect(screen.getByLabelText("Estimate per occurrence (hours)")).toHaveValue(
		4,
	);
	await user.click(screen.getByRole("button", { name: "Preview" }));
	await screen.findByRole("heading", { name: "This and following preview" });
	const request = fetcher.mock.calls.find(([url]) =>
		String(url).endsWith("/occurrences/occ2/preview"),
	);
	expect(JSON.parse(request?.[1]?.body as string)).toEqual({
		estimateMinutes: 240,
	});
	await user.click(screen.getByRole("button", { name: "Save" }));
	await screen.findByRole("heading", { name: "Deadlines" });
	const mutation = fetcher.mock.calls.find(
		([, init]) => init?.method === "PATCH",
	);
	expect(JSON.parse(mutation?.[1]?.body as string)).toEqual({
		estimateMinutes: 240,
		previewVersion,
	});
});

async function tabTo(
	user: ReturnType<typeof userEvent.setup>,
	target: HTMLElement,
) {
	for (let count = 0; count < 30 && document.activeElement !== target; count++)
		await user.tab();
	expect(target).toHaveFocus();
}

it.each([
	"Escape",
	"Cancel",
])("returns keyboard focus to the remounted Edit button after scope %s", async (dismiss) => {
	mockApi();
	await renderRoute("/deadlines/occ2");
	const user = userEvent.setup();
	await tabTo(user, await screen.findByRole("button", { name: "Edit" }));
	await user.keyboard("{Enter}");
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "This occurrence" }),
		).toHaveFocus(),
	);
	if (dismiss === "Escape") await user.keyboard("{Escape}");
	else {
		await user.tab();
		await user.tab();
		expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
		await user.keyboard("{Enter}");
	}
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus(),
	);
	await user.tab();
	expect(screen.getByRole("button", { name: "Mark done" })).toHaveFocus();
});

it.each([
	"Escape",
	"Cancel",
])("returns keyboard focus to Delete after dismissing its scope prompt with %s", async (dismiss) => {
	mockApi();
	await renderRoute("/deadlines/occ2");
	const user = userEvent.setup();
	const origin = await screen.findByRole("button", { name: "Delete" });
	await tabTo(user, origin);
	await user.keyboard("{Enter}");
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "This occurrence" }),
		).toHaveFocus(),
	);
	if (dismiss === "Escape") await user.keyboard("{Escape}");
	else {
		await user.tab();
		await user.tab();
		await user.keyboard("{Enter}");
	}
	await waitFor(() => expect(origin).toHaveFocus());
	expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([
	"this",
	"following",
])("moves keyboard focus into the %s edit form after choosing scope", async (scope) => {
	mockApi();
	await renderRoute("/deadlines/occ2");
	const user = userEvent.setup();
	await tabTo(user, await screen.findByRole("button", { name: "Edit" }));
	await user.keyboard("{Enter}");
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "This occurrence" }),
		).toHaveFocus(),
	);
	if (scope === "following") await user.tab();
	await user.keyboard("{Enter}");
	await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());
	await user.tab();
	expect(screen.getByLabelText("Type")).toHaveFocus();
});

it.each([
	"Escape",
	"Cancel",
])("focuses the delete confirmation then restores Delete after %s", async (dismiss) => {
	mockApi();
	await renderRoute("/deadlines/occ2");
	const user = userEvent.setup();
	const origin = await screen.findByRole("button", { name: "Delete" });
	await tabTo(user, origin);
	await user.keyboard("{Enter}");
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "This occurrence" }),
		).toHaveFocus(),
	);
	await user.tab();
	await user.keyboard("{Enter}");
	const dialog = await screen.findByRole("dialog", {
		name: "Delete this and following occurrences?",
	});
	await waitFor(() =>
		expect(
			within(dialog).getByRole("button", { name: "Cancel" }),
		).toHaveFocus(),
	);
	if (dismiss === "Escape") await user.keyboard("{Escape}");
	else {
		await user.tab();
		await user.tab({ shift: true });
		await user.keyboard("{Enter}");
	}
	await waitFor(() => expect(origin).toHaveFocus());
});
