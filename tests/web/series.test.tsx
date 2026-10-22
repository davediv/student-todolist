import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SeriesForm } from "../../src/components/series/series-form";
import { deadlinesQueryOptions } from "../../src/lib/deadlines-query";
import { renderRoute, student } from "./router";

const previewVersion = { revision: 2, today: "2026-10-14" };
const preview = {
	previewVersion,
	occurrences: [
		{
			dueDate: "2026-10-16",
			startDate: "2026-10-09",
			sessions: [{ date: "2026-10-14", minutes: 180 }],
			shortfallMinutes: 0,
		},
		{
			dueDate: "2026-10-23",
			startDate: "2026-10-16",
			sessions: [{ date: "2026-10-19", minutes: 120 }],
			shortfallMinutes: 60,
		},
	],
};
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 14, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function fillForm(chooseWeekday = true) {
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Title"), "Problem set");
	fireEvent.change(screen.getByLabelText("Estimate per occurrence (hours)"), {
		target: { value: "3" },
	});
	fireEvent.change(screen.getByLabelText("End date"), {
		target: { value: "2026-11-13" },
	});
	if (chooseWeekday)
		await user.click(screen.getByRole("checkbox", { name: "Friday" }));
	return user;
}

it("validates a required weekday and keeps the default seven lead days", async () => {
	const fetcher = vi.spyOn(globalThis, "fetch");
	render(<SeriesForm onSaved={async () => {}} onCancel={() => {}} />);
	const user = await fillForm(false);
	expect(screen.getByLabelText("Lead days")).toHaveValue(7);
	await user.click(screen.getByRole("button", { name: "Preview" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(/weekday|day/i);
	expect(fetcher).not.toHaveBeenCalled();
	expect(screen.getByLabelText("End date")).toHaveAttribute(
		"min",
		"2026-10-15",
	);
	expect(screen.getByLabelText("End date")).toHaveAttribute(
		"max",
		"2027-10-14",
	);
});

it("previews every occurrence and shortfall, then Cancel preserves the series fields without saving", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => new Response(JSON.stringify(preview)));
	const saved = vi.fn(async () => {});
	render(<SeriesForm onSaved={saved} onCancel={() => {}} />);
	const user = await fillForm();
	await user.click(screen.getByRole("button", { name: "Preview" }));
	expect(
		await screen.findByRole("heading", { name: "Recurring deadline preview" }),
	).toBeVisible();
	expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2);
	expect(screen.getByText("Problem set is 1h short")).toBeVisible();
	expect(screen.getByText("3h")).toBeVisible();
	expect(screen.getByText("2h")).toBeVisible();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.getByLabelText("Title")).toHaveValue("Problem set");
	expect(screen.getByLabelText("Estimate per occurrence (hours)")).toHaveValue(
		3,
	);
	expect(screen.getByRole("checkbox", { name: "Friday" })).toBeChecked();
	expect(screen.getByLabelText("End date")).toHaveValue("2026-11-13");
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(String(fetcher.mock.calls[0][0])).toBe("/api/series/preview");
	expect(saved).not.toHaveBeenCalled();
});

it("confirms the complete series with its preview version and selected weekdays", async () => {
	const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
		async (url) =>
			new Response(JSON.stringify(preview), {
				status: String(url).endsWith("/preview") ? 200 : 201,
			}),
	);
	const saved = vi.fn(async () => {});
	render(<SeriesForm onSaved={saved} onCancel={() => {}} />);
	const user = await fillForm(false);
	await user.click(screen.getByRole("checkbox", { name: "Thursday" }));
	await user.click(screen.getByRole("checkbox", { name: "Tuesday" }));
	await user.type(
		screen.getByLabelText("Notes (optional)"),
		"Show your working",
	);
	await user.click(screen.getByRole("button", { name: "Preview" }));
	await screen.findByRole("heading", { name: "Recurring deadline preview" });
	expect(saved).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	const body = {
		title: "Problem set",
		type: "assignment",
		estimateMinutes: 180,
		weekdays: [2, 4],
		leadDays: 7,
		endDate: "2026-11-13",
		notes: "Show your working",
	};
	expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual(body);
	expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({
		...body,
		previewVersion,
	});
	expect(String(fetcher.mock.calls[1][0])).toBe("/api/series");
	expect(fetcher.mock.calls[1][1]?.method).toBe("POST");
});

it("refreshes a stale series preview and requires another Confirm with the updated version", async () => {
	let previews = 0;
	let confirms = 0;
	let resolve!: (response: Response) => void;
	const nextVersion = { revision: 3, today: "2026-10-14" };
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url) => {
			if (String(url).endsWith("/preview")) {
				previews++;
				return previews === 1
					? new Response(JSON.stringify(preview))
					: new Promise<Response>((done) => {
							resolve = done;
						});
			}
			confirms++;
			return confirms === 1
				? new Response(
						JSON.stringify({
							error: { code: "plan_changed", message: "Your plan changed" },
						}),
						{ status: 409 },
					)
				: new Response("{}", { status: 201 });
		});
	const saved = vi.fn(async () => {});
	render(<SeriesForm onSaved={saved} onCancel={() => {}} />);
	const user = await fillForm();
	await user.click(screen.getByRole("button", { name: "Preview" }));
	await screen.findByRole("heading", { name: "Recurring deadline preview" });
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	expect(
		await screen.findByText("Your plan changed. Review the updated preview."),
	).toBeVisible();
	expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
	expect(saved).not.toHaveBeenCalled();
	resolve(
		new Response(JSON.stringify({ ...preview, previewVersion: nextVersion })),
	);
	await screen.findByRole("button", { name: "Confirm" });
	expect(confirms).toBe(1);
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
	const saves = fetcher.mock.calls.filter(([url]) =>
		String(url).endsWith("/series"),
	);
	expect(JSON.parse(saves[0][1]?.body as string).previewVersion).toEqual(
		previewVersion,
	);
	expect(JSON.parse(saves[1][1]?.body as string).previewVersion).toEqual(
		nextVersion,
	);
});

it("keeps the preview after failed creation and allows Confirm to retry", async () => {
	let fail = true;
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async (url) =>
			new Response(JSON.stringify(preview), {
				status: String(url).endsWith("/preview") ? 200 : fail ? 500 : 201,
			}),
	);
	const saved = vi.fn(async () => {});
	render(<SeriesForm onSaved={saved} onCancel={() => {}} />);
	const user = await fillForm();
	await user.click(screen.getByRole("button", { name: "Preview" }));
	await screen.findByRole("heading", { name: "Recurring deadline preview" });
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't create recurring deadline — try again",
	);
	expect(
		screen.getByRole("heading", { name: "Recurring deadline preview" }),
	).toBeVisible();
	fail = false;
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
});

it("opens the recurring deadline form from Today's Add menu", async () => {
	await renderRoute();
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Add" }));
	await user.click(
		screen.getByRole("menuitem", { name: "Recurring deadline" }),
	);
	expect(
		await screen.findByRole("heading", { name: "Add a recurring deadline" }),
	).toBeVisible();
	expect(screen.getByLabelText("Lead days")).toHaveValue(7);
});

it("marks recurring occurrences in Deadlines while preserving ordinary deadline links", async () => {
	const { queryClient } = await renderRoute("/deadlines");
	await act(async () => {
		queryClient.setQueryData(deadlinesQueryOptions.queryKey, {
			pastDue: [],
			done: [],
			active: [
				{
					id: "occurrence",
					userId: student.id,
					seriesId: "series-one",
					title: "Problem set",
					type: "assignment",
					dueDate: "2026-10-16",
					startDate: "2026-10-09",
					estimateMinutes: 180,
					notes: "",
					status: "active",
					createdAt: new Date().toISOString(),
					doneAt: null,
					tickedMinutes: 0,
					plannedMinutes: 180,
					unplannedMinutes: 0,
				},
			],
		});
	});
	expect(await screen.findByText("Recurring deadline")).toBeInTheDocument();
	expect(screen.getByRole("link", { name: /Problem set/ })).toHaveAttribute(
		"href",
		"/deadlines/occurrence",
	);
});
