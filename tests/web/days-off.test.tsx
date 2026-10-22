import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { localDate } from "../../src/lib/format";
import { defaultLimits } from "../../src/lib/limits";
import { addDays } from "../../src/lib/planner";
import { renderRoute, student } from "./router";

afterEach(() => vi.restoreAllMocks());
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

it("adds a date at zero hours, lists it and removes it", async () => {
	let rows: {
		id: string;
		userId: string;
		date: string;
		limitMinutes: number;
	}[] = [];
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (_url, init) => {
			if (init?.method === "POST") {
				rows = [
					{
						id: "day-off",
						userId: student.id,
						...JSON.parse(init.body as string),
					},
				];
				return json(rows[0], 201);
			}
			if (init?.method === "DELETE") {
				rows = [];
				return json({ deleted: "day-off" });
			}
			return json(rows);
		});
	await renderRoute("/settings");
	const user = userEvent.setup();
	expect(
		screen.getByRole("spinbutton", { name: "Day off limit (hours)" }),
	).toHaveValue(0);
	expect(screen.getByLabelText("Day off date")).toHaveAttribute(
		"min",
		localDate(),
	);
	fireEvent.change(screen.getByLabelText("Day off date"), {
		target: { value: addDays(localDate(), 1) },
	});
	await user.click(screen.getByRole("button", { name: "Add day off" }));
	const remove = await screen.findByRole("button", { name: /Remove day off/ });
	expect(
		fetcher.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body,
	).toBe(JSON.stringify({ date: addDays(localDate(), 1), limitMinutes: 0 }));
	expect(screen.getByText(/· 0h/)).toBeVisible();
	await user.click(remove);
	expect(await screen.findByText("No upcoming days off")).toBeVisible();
	expect(
		fetcher.mock.calls.find(([, init]) => init?.method === "DELETE")?.[0],
	).toBe("/api/days-off/day-off");
});
it("validates dates and half-hour limits without sending invalid data", async () => {
	const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
	await renderRoute("/settings");
	const user = userEvent.setup();
	fireEvent.change(screen.getByLabelText("Day off date"), {
		target: { value: addDays(localDate(), -1) },
	});
	fireEvent.change(screen.getByLabelText("Day off limit (hours)"), {
		target: { value: "12.5" },
	});
	await user.click(screen.getByRole("button", { name: "Add day off" }));
	expect(screen.getByText("Choose today or a later date")).toBeVisible();
	expect(
		screen.getByText("Choose 0–12 hours in half-hour steps"),
	).toBeVisible();
	expect(fetcher).not.toHaveBeenCalled();
});
it("retains input after a duplicate response and permits a corrected save", async () => {
	let saved = false;
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (_url, init) => {
			if (init?.method === "POST") {
				if (!saved) {
					saved = true;
					return json(
						{
							error: {
								code: "duplicate",
								message: "This date already has a day off",
							},
						},
						409,
					);
				}
				return json(
					{
						id: "saved",
						userId: student.id,
						...JSON.parse(init.body as string),
					},
					201,
				);
			}
			return json([]);
		});
	await renderRoute("/settings");
	const user = userEvent.setup();
	const date = screen.getByLabelText("Day off date");
	fireEvent.change(date, { target: { value: localDate() } });
	fireEvent.change(screen.getByLabelText("Day off limit (hours)"), {
		target: { value: "1" },
	});
	await user.click(screen.getByRole("button", { name: "Add day off" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"This date already has a day off",
	);
	expect(date).toHaveValue(localDate());
	expect(screen.getByLabelText("Day off limit (hours)")).toHaveValue(1);
	fireEvent.change(date, { target: { value: addDays(localDate(), 1) } });
	await user.click(screen.getByRole("button", { name: "Add day off" }));
	await waitFor(() => expect(date).toHaveValue(""));
	expect(
		fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
	).toHaveLength(2);
});
it("shows a load failure with a retry", async () => {
	vi.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(json({}, 500))
		.mockImplementation(async () => json([]));
	await renderRoute("/settings", student, Date.now(), defaultLimits, false);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't load days off",
	);
	await userEvent
		.setup()
		.click(screen.getByRole("button", { name: "Retry days off" }));
	expect(await screen.findByText("No upcoming days off")).toBeVisible();
});
it("marks a day off and preserves sessions with an over-limit warning in Upcoming", async () => {
	const date = addDays(localDate(), 1);
	vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
		json({
			days: [
				{
					date,
					limitMinutes: 0,
					isDayOff: true,
					plannedMinutes: 60,
					overLimit: true,
					sessions: [
						{
							id: "study",
							userId: student.id,
							deadlineId: "essay",
							date,
							minutes: 60,
							ticked: false,
							tickedAt: null,
							title: "Essay",
							type: "assignment",
							dueDate: addDays(date, 3),
						},
					],
					todos: [],
				},
			],
			anytime: [],
		}),
	);
	await renderRoute("/upcoming", student, Date.now(), defaultLimits, false);
	expect(await screen.findByText("Day off · 0h")).toBeVisible();
	expect(screen.getByText(/Over limit/)).toBeVisible();
	expect(screen.getByRole("checkbox", { name: "Essay, 1h" })).toBeVisible();
});
