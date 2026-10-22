import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeadlineForm } from "../../src/components/deadlines/deadline-form";
import type { DeadlineInput } from "../../src/lib/deadlines";
import { renderRoute } from "./router";

const initial: DeadlineInput = {
	title: "Essay",
	type: "assignment",
	dueDate: "2026-10-30",
	startDate: "2026-10-23",
	estimateMinutes: 360,
	notes: "Read the prompt",
};
const plan = {
	keptSessions: [
		{ id: "ticked", date: "2026-10-26", minutes: 120, ticked: true },
	],
	sessions: [
		{ date: "2026-10-27", minutes: 180 },
		{ date: "2026-10-28", minutes: 180 },
	],
	shortfallMinutes: 0,
};
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 26, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("prefills all fields and saves metadata directly without a preview", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(
			new Response(JSON.stringify({ deadline: initial, ...plan })),
		);
	const saved = vi.fn(async () => {});
	render(
		<DeadlineForm
			initial={initial}
			deadlineId="one"
			onSaved={saved}
			onCancel={() => {}}
		/>,
	);
	expect(screen.getByLabelText("Title")).toHaveValue("Essay");
	expect(screen.getByLabelText("Type")).toHaveValue("assignment");
	expect(screen.getByLabelText("Due date")).toHaveValue(initial.dueDate);
	expect(screen.getByLabelText("Start date")).toHaveValue(initial.startDate);
	expect(screen.getByLabelText("Estimate (hours)")).toHaveValue(6);
	expect(screen.getByLabelText("Notes (optional)")).toHaveValue(initial.notes);
	const user = userEvent.setup();
	await user.clear(screen.getByLabelText("Title"));
	await user.type(screen.getByLabelText("Title"), "Renamed essay");
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(String(fetcher.mock.calls[0][0])).toBe("/api/deadlines/one");
	expect(fetcher.mock.calls[0][1]?.method).toBe("PATCH");
	expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({
		title: "Renamed essay",
		estimateMinutes: 360,
	});
});
it("allows metadata changes after the due date and validates planning changes against today", async () => {
	vi.setSystemTime(new Date(2026, 10, 1, 12));
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(
			async () => new Response(JSON.stringify({ deadline: initial, ...plan })),
		);
	const saved = vi.fn(async () => {});
	render(
		<DeadlineForm
			initial={initial}
			deadlineId="one"
			onSaved={saved}
			onCancel={() => {}}
		/>,
	);
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Title"), " renamed");
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	fireEvent.change(screen.getByLabelText("Estimate (hours)"), {
		target: { value: "8" },
	});
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(await screen.findByText("Due date must be after today")).toBeVisible();
	expect(fetcher).toHaveBeenCalledTimes(1);
});
it("previews the kept sessions, replacements and shortfall, then Cancel retains edits without writing", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(
			new Response(JSON.stringify({ ...plan, shortfallMinutes: 180 })),
		);
	const saved = vi.fn(async () => {});
	render(
		<DeadlineForm
			initial={initial}
			deadlineId="one"
			onSaved={saved}
			onCancel={() => {}}
		/>,
	);
	const user = userEvent.setup();
	fireEvent.change(screen.getByLabelText("Estimate (hours)"), {
		target: { value: "8" },
	});
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(
		await screen.findByRole("heading", { name: "Plan preview" }),
	).toBeVisible();
	expect(screen.getByRole("heading", { name: "Kept sessions" })).toBeVisible();
	expect(screen.getByRole("heading", { name: "New sessions" })).toBeVisible();
	expect(screen.getByText("2h")).toBeVisible();
	expect(screen.getAllByText("3h")).toHaveLength(2);
	expect(screen.getByText("Essay is 3h short")).toBeVisible();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.getByLabelText("Estimate (hours)")).toHaveValue(8);
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(String(fetcher.mock.calls[0][0])).toBe("/api/deadlines/one/preview");
	expect(saved).not.toHaveBeenCalled();
});
it("requires Save in the preview and retains it after a failed save for retry", async () => {
	let fail = true;
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url) => {
			if (String(url).endsWith("/preview"))
				return new Response(JSON.stringify(plan));
			return new Response(JSON.stringify({ deadline: initial, ...plan }), {
				status: fail ? 409 : 200,
			});
		});
	const saved = vi.fn(async () => {});
	render(
		<DeadlineForm
			initial={initial}
			deadlineId="one"
			onSaved={saved}
			onCancel={() => {}}
		/>,
	);
	const user = userEvent.setup();
	fireEvent.change(screen.getByLabelText("Estimate (hours)"), {
		target: { value: "8" },
	});
	await user.click(screen.getByRole("button", { name: "Save" }));
	await screen.findByRole("heading", { name: "Plan preview" });
	expect(saved).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't save — try again",
	);
	expect(screen.getByRole("heading", { name: "Plan preview" })).toBeVisible();
	fail = false;
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	expect(
		fetcher.mock.calls.map(([url, options]) => [String(url), options?.method]),
	).toEqual([
		["/api/deadlines/one/preview", "POST"],
		["/api/deadlines/one", "PATCH"],
		["/api/deadlines/one", "PATCH"],
	]);
});
it("opens Edit from detail, refreshes the saved deadline, and closes the form", async () => {
	let title = initial.title;
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
		if (options?.method === "PATCH")
			title = (JSON.parse(options.body as string) as DeadlineInput).title;
		return new Response(
			JSON.stringify({
				deadline: {
					...initial,
					id: "one",
					title,
					status: "active",
					tickedMinutes: 120,
					plannedMinutes: 300,
					unplannedMinutes: 60,
					createdAt: "2026-10-23",
					doneAt: null,
				},
				sessions: [],
			}),
		);
	});
	await renderRoute("/deadlines/one");
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Edit" }));
	expect(screen.getByLabelText("Title")).toHaveValue("Essay");
	await user.clear(screen.getByLabelText("Title"));
	await user.type(screen.getByLabelText("Title"), "Updated essay");
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(
		await screen.findByRole("heading", { name: "Updated essay" }),
	).toBeVisible();
	await waitFor(() =>
		expect(
			screen.queryByRole("heading", { name: "Edit deadline" }),
		).not.toBeInTheDocument(),
	);
});

it("refreshes a stale edit preview after a conflict and saves only after the updated preview is reviewed", async () => {
	const originalVersion = { revision: 2, today: "2026-10-26" };
	const updatedVersion = { revision: 3, today: "2026-10-26" };
	let previewCalls = 0;
	let saveCalls = 0;
	let refresh!: (response: Response) => void;
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url) => {
			if (String(url).endsWith("/preview")) {
				previewCalls++;
				return previewCalls === 1
					? new Response(
							JSON.stringify({ ...plan, previewVersion: originalVersion }),
						)
					: new Promise<Response>((resolve) => {
							refresh = resolve;
						});
			}
			saveCalls++;
			return saveCalls === 1
				? new Response(
						JSON.stringify({
							error: { code: "plan_changed", message: "Your plan changed" },
						}),
						{ status: 409 },
					)
				: new Response(JSON.stringify({ deadline: initial, ...plan }));
		});
	const saved = vi.fn(async () => {});
	render(
		<DeadlineForm
			initial={initial}
			deadlineId="one"
			onSaved={saved}
			onCancel={() => {}}
		/>,
	);
	const user = userEvent.setup();
	fireEvent.change(screen.getByLabelText("Estimate (hours)"), {
		target: { value: "8" },
	});
	await user.click(screen.getByRole("button", { name: "Save" }));
	await screen.findByRole("heading", { name: "Plan preview" });
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(
		await screen.findByText("Your plan changed. Review the updated preview."),
	).toBeVisible();
	expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
	expect(screen.queryByRole("heading", { name: "Plan preview" })).toBeNull();
	expect(saved).not.toHaveBeenCalled();
	refresh(
		new Response(
			JSON.stringify({
				...plan,
				sessions: [{ date: "2026-10-29", minutes: 120 }],
				shortfallMinutes: 240,
				previewVersion: updatedVersion,
			}),
		),
	);
	expect(await screen.findByText("Essay is 4h short")).toBeVisible();
	expect(saveCalls).toBe(1);
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	const saves = fetcher.mock.calls.filter(
		([, init]) => init?.method === "PATCH",
	);
	expect(JSON.parse(saves[0][1]?.body as string).previewVersion).toEqual(
		originalVersion,
	);
	expect(JSON.parse(saves[1][1]?.body as string).previewVersion).toEqual(
		updatedVersion,
	);
});
