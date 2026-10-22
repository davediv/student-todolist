import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeadlineForm } from "../../src/components/deadlines/deadline-form";
import { renderRoute } from "./router";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 26, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
async function fillForm() {
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Title"), "Essay (CS101)");
	fireEvent.change(screen.getByLabelText("Due date"), {
		target: { value: "2026-10-30" },
	});
	await user.type(screen.getByLabelText("Estimate (hours)"), "6");
	return user;
}
const plan = {
	sessions: [
		{ date: "2026-10-26", minutes: 180 },
		{ date: "2026-10-27", minutes: 180 },
	],
	shortfallMinutes: 0,
};
it("validates blank inputs and follows the due date until the start is edited", async () => {
	render(<DeadlineForm onSaved={async () => {}} onCancel={() => {}} />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Preview plan" }));
	expect(await screen.findByText("Enter a title")).toBeVisible();
	expect(screen.getByText("Enter a due date")).toBeVisible();
	expect(screen.getByText("Estimate must be at least 0.5h")).toBeVisible();
	fireEvent.change(screen.getByLabelText("Due date"), {
		target: { value: "2026-10-30" },
	});
	await waitFor(() =>
		expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-23"),
	);
	fireEvent.change(screen.getByLabelText("Due date"), {
		target: { value: "2026-11-01" },
	});
	await waitFor(() =>
		expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-25"),
	);
	fireEvent.change(screen.getByLabelText("Start date"), {
		target: { value: "2026-10-20" },
	});
	fireEvent.change(screen.getByLabelText("Due date"), {
		target: { value: "2026-11-02" },
	});
	expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-20");
});
it("keeps form values on preview cancel and creates nothing until Save", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => new Response(JSON.stringify(plan)));
	const saved = vi.fn(async () => {});
	render(<DeadlineForm onSaved={saved} onCancel={() => {}} />);
	const user = await fillForm();
	await user.click(screen.getByRole("button", { name: "Preview plan" }));
	expect(
		await screen.findByRole("heading", { name: "Plan preview" }),
	).toBeVisible();
	expect(screen.getAllByText("3h")).toHaveLength(2);
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.getByLabelText("Title")).toHaveValue("Essay (CS101)");
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(String(fetcher.mock.calls[0][0])).toBe("/api/deadlines/preview");
	expect(saved).not.toHaveBeenCalled();
});
it("shows shortfalls, keeps the preview after failed saves, and allows retry", async () => {
	let fail = true;
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url) => {
			if (String(url).endsWith("/preview"))
				return new Response(JSON.stringify({ ...plan, shortfallMinutes: 180 }));
			return fail
				? new Response('{"error":{"code":"internal","message":"failed"}}', {
						status: 500,
					})
				: new Response(
						JSON.stringify({ deadline: { id: "created" }, ...plan }),
						{ status: 201 },
					);
		});
	const saved = vi.fn(async () => {});
	render(<DeadlineForm onSaved={saved} onCancel={() => {}} />);
	const user = await fillForm();
	await user.click(screen.getByRole("button", { name: "Preview plan" }));
	expect(await screen.findByText("Essay (CS101) is 3h short")).toBeVisible();
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't save — try again",
	);
	expect(screen.getByRole("heading", { name: "Plan preview" })).toBeVisible();
	expect(saved).not.toHaveBeenCalled();
	fail = false;
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	const body = JSON.parse(fetcher.mock.calls[1][1]?.body as string);
	expect(body).toMatchObject({
		title: "Essay (CS101)",
		estimateMinutes: 360,
		startDate: "2026-10-23",
	});
});
it("opens a deadline detail with its sessions and unplanned hours", async () => {
	const deadline = {
		id: "one",
		userId: "student-id",
		title: "Large project",
		type: "project",
		dueDate: "2026-10-30",
		startDate: "2026-10-23",
		estimateMinutes: 600,
		notes: "Bring notes",
		status: "active",
		createdAt: new Date().toISOString(),
		doneAt: null,
		tickedMinutes: 0,
		plannedMinutes: 360,
		unplannedMinutes: 240,
	};
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async () =>
			new Response(
				JSON.stringify({
					deadline,
					sessions: plan.sessions.map((session, i) => ({
						...session,
						id: String(i),
						ticked: false,
					})),
				}),
			),
	);
	await renderRoute("/deadlines/one");
	expect(
		await screen.findByRole("heading", { name: "Large project" }),
	).toBeVisible();
	expect(screen.getByText("4h unplanned")).toBeVisible();
	expect(screen.getAllByText("3h")).toHaveLength(2);
	expect(screen.getByText("Bring notes")).toBeVisible();
});
