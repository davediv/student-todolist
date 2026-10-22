import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DaySession, PlanDay } from "../../src/lib/days-query";
import { defaultLimits } from "../../src/lib/limits";
import { addDays } from "../../src/lib/planner";
import { renderRoute, student } from "./router";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 31, 23, 30));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function emptyDays(): PlanDay[] {
	return Array.from({ length: 14 }, (_, i) => ({
		date: addDays("2026-10-31", i + 1),
		limitMinutes: 180,
		plannedMinutes: 0,
		overLimit: false,
		sessions: [],
	}));
}
function plannedDays(): PlanDay[] {
	const days = emptyDays();
	const session: DaySession = {
		id: "study-one",
		userId: student.id,
		deadlineId: "essay",
		date: days[0].date,
		minutes: 120,
		ticked: false,
		tickedAt: null,
		title: "Read the research",
		type: "reading",
		dueDate: "2026-11-05",
	};
	days[0] = {
		...days[0],
		plannedMinutes: 120,
		sessions: [session],
	};
	return days;
}

it("requests the 14 local dates after today across a month boundary, retaining empty day headers", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(
			async () => new Response(JSON.stringify({ days: emptyDays() })),
		);
	const view = await renderRoute(
		"/upcoming",
		student,
		Date.now(),
		defaultLimits,
		false,
	);
	expect(
		await screen.findByText("No study planned in the next 14 days"),
	).toBeVisible();
	const dayDates = Array.from(
		view.container.querySelectorAll(".day-card h3 time"),
	).map((heading) => heading.getAttribute("datetime"));
	expect(dayDates).toHaveLength(14);
	expect(dayDates).toEqual(emptyDays().map((day) => day.date));
	expect(screen.getByRole("heading", { name: "Sun 1 Nov" })).toBeVisible();
	expect(screen.getByRole("heading", { name: "Sat 14 Nov" })).toBeVisible();
	expect(screen.getAllByText("0h / 3h")).toHaveLength(14);
	expect(String(fetcher.mock.calls[0][0])).toBe(
		"/api/days?from=2026-11-01&to=2026-11-14",
	);
	expect(
		new Headers(fetcher.mock.calls[0][1]?.headers).get("X-Local-Date"),
	).toBe("2026-10-31");
});

it("shows the over-limit warning beside the same sessions after limits shrink", async () => {
	const days = plannedDays();
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async () => new Response(JSON.stringify({ days })),
	);
	const { queryClient } = await renderRoute(
		"/upcoming",
		student,
		Date.now(),
		defaultLimits,
		false,
	);
	const checkbox = await screen.findByRole("checkbox", {
		name: "Read the research, 2h",
	});
	expect(screen.queryByText(/Over limit/)).not.toBeInTheDocument();
	days[0] = { ...days[0], limitMinutes: 60, overLimit: true };
	await queryClient.invalidateQueries({ queryKey: ["days"] });
	expect(await screen.findByText(/Over limit/)).toBeVisible();
	expect(screen.getByText(/2h \/ 1h/)).toBeVisible();
	expect(screen.getByRole("checkbox", { name: "Read the research, 2h" })).toBe(
		checkbox,
	);
	expect(
		screen.getByRole("link", { name: "Read the research" }),
	).toHaveAttribute("href", "/deadlines/essay");
	expect(screen.queryByText("No study planned in the next 14 days")).toBeNull();
});

it("ticks and unticks Upcoming sessions through the shared session controls", async () => {
	const days = plannedDays();
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url, init) => {
			if (init?.method === "PATCH") {
				const { ticked } = JSON.parse(init.body as string) as {
					ticked: boolean;
				};
				days[0].sessions[0].ticked = ticked;
				return new Response(JSON.stringify(days[0].sessions[0]));
			}
			if (String(url).startsWith("/api/days"))
				return new Response(JSON.stringify({ days }));
			return new Response("[]");
		});
	await renderRoute("/upcoming", student, Date.now(), defaultLimits, false);
	const user = userEvent.setup();
	const checkbox = await screen.findByRole("checkbox", {
		name: "Read the research, 2h",
	});
	await user.click(checkbox);
	await waitFor(() => expect(checkbox).toBeChecked());
	expect(screen.getByRole("link", { name: "Read the research" })).toHaveStyle({
		textDecoration: "line-through",
	});
	await user.click(checkbox);
	await waitFor(() => expect(checkbox).not.toBeChecked());
	const mutations = fetcher.mock.calls.filter(
		([, init]) => init?.method === "PATCH",
	);
	expect(mutations.map(([url]) => String(url))).toEqual([
		"/api/sessions/study-one",
		"/api/sessions/study-one",
	]);
	expect(mutations.map(([, init]) => JSON.parse(init?.body as string))).toEqual(
		[{ ticked: true }, { ticked: false }],
	);
});

it("shows skeleton rows while the upcoming plan loads", async () => {
	let resolve!: (response: Response) => void;
	vi.spyOn(globalThis, "fetch").mockImplementation(
		() =>
			new Promise<Response>((done) => {
				resolve = done;
			}),
	);
	await renderRoute("/upcoming", student, Date.now(), defaultLimits, false);
	expect(await screen.findByText("Loading Student Todo")).toBeInTheDocument();
	resolve(new Response(JSON.stringify({ days: emptyDays() })));
	expect(
		await screen.findByText("No study planned in the next 14 days"),
	).toBeVisible();
	expect(screen.queryByText("Loading Student Todo")).toBeNull();
});

it("retries a failed upcoming load and displays the recovered plan", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(new Response("{}", { status: 500 }))
		.mockImplementation(
			async () => new Response(JSON.stringify({ days: plannedDays() })),
		);
	await renderRoute("/upcoming", student, Date.now(), defaultLimits, false);
	const alert = await screen.findByRole("alert");
	expect(alert).toHaveTextContent("Couldn't load your plan — retry");
	await userEvent
		.setup()
		.click(within(alert).getByRole("button", { name: "Retry" }));
	expect(
		await screen.findByRole("checkbox", { name: "Read the research, 2h" }),
	).toBeVisible();
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(screen.queryByRole("alert")).toBeNull();
});
