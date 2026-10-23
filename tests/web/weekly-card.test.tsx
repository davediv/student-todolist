import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WeeklyCard } from "../../src/components/stats/weekly-card";
import type { DaySession } from "../../src/lib/days-query";
import { defaultLimits } from "../../src/lib/limits";
import { recentWeeks } from "../../src/lib/week";
import { renderRoute, student } from "./router";

const today = "2026-10-23";
function weekly(doneMinutes = 420, plannedMinutes = 720) {
	return {
		weeks: recentWeeks(today).map((week, index) => ({
			...week,
			doneMinutes: index === 0 ? doneMinutes : index * 60,
			plannedMinutes: index === 0 ? plannedMinutes : index * 120,
		})),
	};
}
function response(value: unknown) {
	return new Response(JSON.stringify(value));
}
function setup() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<WeeklyCard today={today} />
		</QueryClientProvider>,
	);
	return userEvent.setup();
}
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 23, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("shows 7 / 12h and exposes the done and planned hours in its progress bar", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => response(weekly()));
	setup();
	expect(
		await screen.findByRole("button", {
			name: "This week 7 / 12h. Show last 4 weeks",
		}),
	).toBeVisible();
	const bar = screen.getByRole("progressbar", {
		name: "This week's study hours",
	});
	expect(bar).toHaveAttribute("aria-valuenow", "7");
	expect(bar).toHaveAttribute("aria-valuemax", "12");
	expect(bar).toHaveAttribute("aria-valuetext", "7 of 12 hours done");
	expect(String(fetcher.mock.calls[0][0])).toBe("/api/stats/weekly");
	expect(
		new Headers(fetcher.mock.calls[0][1]?.headers).get("X-Local-Date"),
	).toBe(today);
});

it("shows 0 / 0h for an empty week with a zero progress bar", async () => {
	vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
		response(weekly(0, 0)),
	);
	setup();
	expect(
		await screen.findByRole("button", { name: /This week 0 \/ 0h/ }),
	).toBeVisible();
	const bar = screen.getByRole("progressbar");
	expect(bar).toHaveAttribute("aria-valuenow", "0");
	expect(bar).toHaveAttribute("aria-valuemax", "0");
	expect(bar.firstElementChild).toHaveStyle({ width: "0%" });
});

it("opens four labelled weeks by keyboard and restores focus on Escape or Back", async () => {
	vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
		response(weekly()),
	);
	const user = setup();
	const card = await screen.findByRole("button", {
		name: /This week 7 \/ 12h/,
	});
	card.focus();
	await user.keyboard("{Enter}");
	let dialog = await screen.findByRole("dialog", { name: "Last 4 weeks" });
	expect(within(dialog).getAllByRole("progressbar")).toHaveLength(4);
	for (const [label, done, planned] of [
		["19 Oct – 25 Oct 2026", 7, 12],
		["12 Oct – 18 Oct 2026", 1, 2],
		["5 Oct – 11 Oct 2026", 2, 4],
		["28 Sept – 4 Oct 2026", 3, 6],
	] as const) {
		const bar = within(dialog).getByRole("progressbar", { name: label });
		expect(bar).toHaveAttribute("aria-valuenow", String(done));
		expect(bar).toHaveAttribute("aria-valuemax", String(planned));
		expect(within(dialog).getByText(`${done} / ${planned}h`)).toBeVisible();
	}
	await user.keyboard("{Escape}");
	await waitFor(() =>
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	);
	expect(card).toHaveFocus();
	await user.click(card);
	dialog = await screen.findByRole("dialog", { name: "Last 4 weeks" });
	await user.click(within(dialog).getByRole("button", { name: "Back" }));
	await waitFor(() =>
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	);
	expect(card).toHaveFocus();
});

it("shows a loading state while weekly totals load", async () => {
	let resolve!: (value: Response) => void;
	vi.spyOn(globalThis, "fetch").mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	setup();
	expect(screen.getByRole("status")).toHaveTextContent(
		"Loading weekly progress",
	);
	resolve(response(weekly()));
	expect(
		await screen.findByRole("button", { name: /This week 7 \/ 12h/ }),
	).toBeVisible();
});

it("retries a failed weekly load", async () => {
	vi.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(new Response("{}", { status: 500 }))
		.mockImplementation(async () => response(weekly()));
	const user = setup();
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't load weekly progress",
	);
	await user.click(
		screen.getByRole("button", { name: "Retry weekly progress" }),
	);
	expect(
		await screen.findByRole("button", { name: /This week 7 \/ 12h/ }),
	).toBeVisible();
});

it("refreshes the Upcoming card after ticking and unticking a session on Today without a reload", async () => {
	let ticked = false;
	const session: DaySession = {
		id: "study-one",
		userId: student.id,
		deadlineId: "essay",
		date: today,
		minutes: 120,
		ticked,
		tickedAt: null,
		title: "Research essay",
		type: "assignment",
		dueDate: "2026-10-30",
	};
	const day = () => ({
		date: today,
		isDayOff: false,
		limitMinutes: 180,
		plannedMinutes: 120,
		overLimit: false,
		sessions: [{ ...session, ticked }],
		todos: [],
	});
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url, init) => {
			if (init?.method === "PATCH") {
				ticked = JSON.parse(init.body as string).ticked;
				return response({ session: { ...session, ticked } });
			}
			if (String(url) === "/api/stats/weekly")
				return response(weekly(ticked ? 540 : 420));
			if (String(url).startsWith("/api/days?"))
				return response({ days: [day()], anytime: [] });
			return response([]);
		});
	const { queryClient } = await renderRoute(
		"/upcoming",
		student,
		Date.now(),
		defaultLimits,
		true,
		false,
	);
	queryClient.setQueryData(["days", today, today], {
		days: [day()],
		anytime: [],
	});
	const user = userEvent.setup();
	expect(
		await screen.findByRole("button", { name: /This week 7 \/ 12h/ }),
	).toBeVisible();
	for (const expected of [9, 7]) {
		await user.click(screen.getByRole("link", { name: "Today" }));
		const checkbox = await screen.findByRole("checkbox", {
			name: "Research essay, 2h",
		});
		await user.click(checkbox);
		await waitFor(() =>
			expect(checkbox).toHaveProperty("checked", expected === 9),
		);
		await user.click(screen.getByRole("link", { name: "Upcoming" }));
		expect(
			await screen.findByRole("button", {
				name: new RegExp(`This week ${expected} / 12h`),
			}),
		).toBeVisible();
	}
	expect(
		fetcher.mock.calls.filter(([url]) => String(url) === "/api/stats/weekly")
			.length,
	).toBeGreaterThanOrEqual(3);
});
