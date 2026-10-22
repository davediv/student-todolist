import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultLimits } from "../../src/lib/limits";
import { renderRoute, student } from "./router";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 26, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
const session = {
	id: "session-one",
	userId: student.id,
	deadlineId: "essay",
	date: "2026-10-26",
	minutes: 120,
	ticked: false,
	tickedAt: null,
	title: "Essay (CS101)",
	type: "assignment",
	dueDate: "2026-10-30",
};
const day = {
	date: "2026-10-26",
	plannedMinutes: 120,
	limitMinutes: 180,
	overLimit: false,
	sessions: [session],
};
function json(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), { status });
}
function renderToday() {
	return renderRoute("/", student, Date.now(), defaultLimits, false);
}

it("shows the device's local date, planned hours, and accessible session details", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(json({ days: [day] }));
	await renderToday();
	expect(
		await screen.findByRole("checkbox", { name: "Essay (CS101), 2h" }),
	).not.toBeChecked();
	expect(screen.getByText("Monday, October 26")).toBeVisible();
	expect(screen.getByText("2h / 3h")).toBeVisible();
	expect(screen.getByText("assignment")).toBeVisible();
	expect(screen.getByText("Oct 30")).toHaveAttribute("datetime", "2026-10-30");
	expect(String(fetcher.mock.calls[0][0])).toContain(
		"from=2026-10-26&to=2026-10-26",
	);
});
it("ticks and unticks with a busy checkbox, striking the title and refreshing deadline progress", async () => {
	let ticked = false;
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url, init) => {
			if (init?.method === "PATCH") {
				ticked = JSON.parse(init.body as string).ticked;
				return json({ session: { ...session, ticked } });
			}
			if (String(url).includes("/api/days"))
				return json({ days: [{ ...day, sessions: [{ ...session, ticked }] }] });
			return json([
				{
					id: "essay",
					title: session.title,
					type: "assignment",
					dueDate: session.dueDate,
					tickedMinutes: ticked ? 120 : 0,
					estimateMinutes: 360,
					unplannedMinutes: 0,
				},
			]);
		});
	await renderToday();
	const user = userEvent.setup();
	const checkbox = await screen.findByRole("checkbox", {
		name: "Essay (CS101), 2h",
	});
	await user.click(checkbox);
	await waitFor(() => expect(checkbox).toBeChecked());
	expect(screen.getByRole("link", { name: "Essay (CS101)" })).toHaveStyle({
		textDecoration: "line-through",
	});
	await user.click(screen.getByRole("link", { name: "Deadlines" }));
	expect(await screen.findByText("2 / 6h")).toBeVisible();
	await user.click(screen.getByRole("link", { name: "Today" }));
	const back = await screen.findByRole("checkbox", {
		name: "Essay (CS101), 2h",
	});
	await user.click(back);
	await waitFor(() => expect(back).not.toBeChecked());
	expect(screen.getByRole("link", { name: "Essay (CS101)" })).not.toHaveStyle({
		textDecoration: "line-through",
	});
	expect(
		fetcher.mock.calls
			.filter(([, init]) => init?.method === "PATCH")
			.map(([, init]) => JSON.parse(init?.body as string)),
	).toEqual([{ ticked: true }, { ticked: false }]);
});
it("shows a row-level error without ticking after a failed update", async () => {
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
		init?.method === "PATCH"
			? json({ error: { code: "internal", message: "failed" } }, 500)
			: json({ days: [day] }),
	);
	await renderToday();
	const user = userEvent.setup();
	const checkbox = await screen.findByRole("checkbox", {
		name: "Essay (CS101), 2h",
	});
	await user.click(checkbox);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't update Essay (CS101) — try again",
	);
	expect(checkbox).not.toBeChecked();
	expect(checkbox).toBeEnabled();
});
it("shows skeletons, then an error and a working Retry action", async () => {
	let release: (response: Response) => void = () => {};
	vi.spyOn(globalThis, "fetch")
		.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					release = resolve;
				}),
		)
		.mockImplementation(async () => json({ days: [day] }));
	await renderToday();
	expect(screen.getByText("Loading Student Todo")).toBeVisible();
	release(json({ error: { code: "internal", message: "failed" } }, 500));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't load your plan — retry",
	);
	await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
	expect(
		await screen.findByRole("checkbox", { name: "Essay (CS101), 2h" }),
	).toBeVisible();
});
it("offers Add → Deadline on an empty day and opens the deadline form", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		json({ days: [{ ...day, plannedMinutes: 0, sessions: [] }] }),
	);
	await renderToday();
	expect(
		await screen.findByRole("heading", { name: "Nothing planned today" }),
	).toBeVisible();
	const user = userEvent.setup();
	screen.getByRole("button", { name: "Add" }).focus();
	await user.keyboard("{Enter}");
	await user.click(await screen.findByRole("menuitem", { name: "Deadline" }));
	expect(
		await screen.findByRole("heading", { name: "Add a deadline" }),
	).toBeVisible();
});
