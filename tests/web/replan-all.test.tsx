import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeadlineForm } from "../../src/components/deadlines/deadline-form";
import { ReplanAllPreview } from "../../src/components/plan/replan-all-preview";
import type { DeadlineInput } from "../../src/lib/deadlines";

const input: DeadlineInput = {
	title: "Urgent essay",
	type: "assignment",
	dueDate: "2026-10-29",
	startDate: "2026-10-26",
	estimateMinutes: 240,
	notes: "",
};
const allPlan = {
	previewVersion: { revision: 4, today: "2026-10-26" },
	plans: [
		{
			deadlineId: "pending-new",
			title: "Urgent essay",
			dueDate: "2026-10-29",
			sessions: [
				{ date: "2026-10-26", minutes: 180 },
				{ date: "2026-10-27", minutes: 60 },
			],
			keptSessions: [],
			shortfallMinutes: 0,
		},
		{
			deadlineId: "project",
			title: "Large project",
			dueDate: "2026-11-16",
			sessions: [{ date: "2026-10-27", minutes: 120 }],
			keptSessions: [{ id: "done", date: "2026-10-25", minutes: 60 }],
			shortfallMinutes: 30,
		},
	],
};
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 26, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function openCreate() {
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Title"), input.title);
	fireEvent.change(screen.getByLabelText("Due date"), {
		target: { value: input.dueDate },
	});
	fireEvent.change(screen.getByLabelText("Start date"), {
		target: { value: input.startDate },
	});
	fireEvent.change(screen.getByLabelText("Estimate (hours)"), {
		target: { value: "4" },
	});
	await user.click(screen.getByRole("button", { name: "Preview plan" }));
	await screen.findByRole("heading", { name: "Plan preview" });
	return user;
}
function mockPlans(shortfallMinutes = 240) {
	return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
		if (String(url).startsWith("/api/replan/all"))
			return new Response(JSON.stringify(allPlan));
		return new Response(JSON.stringify({ sessions: [], shortfallMinutes }));
	});
}

it("opens all plans from a create shortfall and cancels back to the original preview without saving", async () => {
	const fetcher = mockPlans();
	const saved = vi.fn(async () => {});
	render(<DeadlineForm onSaved={saved} onCancel={() => {}} />);
	const user = await openCreate();
	expect(screen.getByText("Urgent essay is 4h short")).toBeVisible();
	await user.click(
		screen.getByRole("button", { name: "Re-plan all by due date" }),
	);
	expect(
		await screen.findByRole("heading", { name: "Urgent essay" }),
	).toBeVisible();
	expect(
		screen
			.getAllByRole("heading", { level: 4 })
			.map((heading) => heading.textContent),
	).toEqual(["Urgent essay", "Large project"]);
	expect(screen.getByText("Large project is 0.5h short")).toBeVisible();
	expect(screen.getByRole("heading", { name: "Kept sessions" })).toBeVisible();
	expect(screen.getByText(/Done/)).toBeVisible();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.getByRole("heading", { name: "Plan preview" })).toBeVisible();
	expect(screen.getByText("Urgent essay is 4h short")).toBeVisible();
	expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
		"/api/deadlines/preview",
		"/api/replan/all/preview",
	]);
	expect(saved).not.toHaveBeenCalled();
});

it("sends the pending create in both all-plan preview and Save", async () => {
	const fetcher = mockPlans();
	const saved = vi.fn(async () => {});
	render(<DeadlineForm onSaved={saved} onCancel={() => {}} />);
	const user = await openCreate();
	await user.click(
		screen.getByRole("button", { name: "Re-plan all by due date" }),
	);
	await screen.findByRole("heading", { name: "Urgent essay" });
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	const requests = fetcher.mock.calls.slice(1);
	expect(requests.map(([url]) => String(url))).toEqual([
		"/api/replan/all/preview",
		"/api/replan/all",
	]);
	expect(JSON.parse(requests[0][1]?.body as string)).toEqual({
		pending: { input },
	});
	expect(JSON.parse(requests[1][1]?.body as string)).toEqual({
		pending: { input },
		previewVersion: allPlan.previewVersion,
	});
});

it("includes the edited deadline ID and changed form values in the all-plan save", async () => {
	const fetcher = mockPlans();
	const saved = vi.fn(async () => {});
	render(
		<DeadlineForm
			initial={input}
			deadlineId="essay-one"
			onSaved={saved}
			onCancel={() => {}}
		/>,
	);
	const user = userEvent.setup();
	fireEvent.change(screen.getByLabelText("Estimate (hours)"), {
		target: { value: "6" },
	});
	await user.click(screen.getByRole("button", { name: "Save" }));
	await screen.findByRole("heading", { name: "Plan preview" });
	await user.click(
		screen.getByRole("button", { name: "Re-plan all by due date" }),
	);
	await screen.findByRole("heading", { name: "Urgent essay" });
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	expect(String(fetcher.mock.calls[0][0])).toBe(
		"/api/deadlines/essay-one/preview",
	);
	expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string)).toEqual({
		pending: { id: "essay-one", input: { ...input, estimateMinutes: 360 } },
		previewVersion: allPlan.previewVersion,
	});
});

it("does not offer re-plan all when the original preview has no shortfall", async () => {
	mockPlans(0);
	render(<DeadlineForm onSaved={async () => {}} onCancel={() => {}} />);
	await openCreate();
	expect(
		screen.queryByRole("button", { name: "Re-plan all by due date" }),
	).toBeNull();
});

it("retries preview failures and retains the full preview after failed saves", async () => {
	let previewFails = true;
	let saveFails = true;
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url) => {
			const fail = String(url).endsWith("/preview") ? previewFails : saveFails;
			return new Response(JSON.stringify(fail ? {} : allPlan), {
				status: fail ? 500 : 200,
			});
		});
	const saved = vi.fn(async () => {});
	render(<ReplanAllPreview onSaved={saved} onCancel={() => {}} />);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't preview — try again",
	);
	const user = userEvent.setup();
	previewFails = false;
	await user.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByRole("heading", { name: "Urgent essay" });
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't save — try again",
	);
	expect(screen.getByRole("heading", { name: "Large project" })).toBeVisible();
	expect(saved).not.toHaveBeenCalled();
	saveFails = false;
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
		"/api/replan/all/preview",
		"/api/replan/all/preview",
		"/api/replan/all",
		"/api/replan/all",
	]);
	expect(JSON.parse(fetcher.mock.calls[3][1]?.body as string)).toEqual({
		previewVersion: allPlan.previewVersion,
	});
});

it("refreshes a stale preview after a conflict and requires a second Save with the new version", async () => {
	let refresh!: (response: Response) => void;
	let previewCalls = 0;
	let saveCalls = 0;
	const updated = {
		...allPlan,
		previewVersion: { revision: 5, today: "2026-10-26" },
		plans: [{ ...allPlan.plans[0], title: "Updated essay plan" }],
	};
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url) => {
			if (String(url).endsWith("/preview")) {
				previewCalls++;
				return previewCalls === 1
					? new Response(JSON.stringify(allPlan))
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
				: new Response(JSON.stringify(updated));
		});
	const saved = vi.fn(async () => {});
	render(
		<ReplanAllPreview
			pending={{ input }}
			onSaved={saved}
			onCancel={() => {}}
		/>,
	);
	await screen.findByRole("heading", { name: "Urgent essay" });
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(
		await screen.findByText("Your plan changed. Review the updated preview."),
	).toBeVisible();
	expect(screen.queryByRole("heading", { name: "Urgent essay" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
	expect(saved).not.toHaveBeenCalled();
	refresh(new Response(JSON.stringify(updated)));
	expect(
		await screen.findByRole("heading", { name: "Updated essay plan" }),
	).toBeVisible();
	expect(saveCalls).toBe(1);
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	const saves = fetcher.mock.calls.filter(([url]) =>
		String(url).endsWith("/replan/all"),
	);
	expect(JSON.parse(saves[0][1]?.body as string)).toEqual({
		pending: { input },
		previewVersion: allPlan.previewVersion,
	});
	expect(JSON.parse(saves[1][1]?.body as string)).toEqual({
		pending: { input },
		previewVersion: updated.previewVersion,
	});
});

it("allows cancelling a loading preview without applying any plan", async () => {
	vi.spyOn(globalThis, "fetch").mockImplementation(
		() => new Promise<Response>(() => {}),
	);
	const cancel = vi.fn();
	render(<ReplanAllPreview onSaved={async () => {}} onCancel={cancel} />);
	const section = screen
		.getByRole("heading", { name: "Re-plan all by due date" })
		.closest("section");
	expect(
		within(section as HTMLElement).getByText("Loading Student Todo"),
	).toBeInTheDocument();
	await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
	expect(cancel).toHaveBeenCalledTimes(1);
	expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});
