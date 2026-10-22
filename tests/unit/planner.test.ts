import { describe, expect, it } from "vitest";
import {
	addDays,
	type PlannerCalendar,
	type PlannerDeadline,
	type PlannerSession,
	planDeadline,
	replanAll,
	replanOverdue,
} from "../../src/lib/planner";

// 2026-10-19 is Monday. Limits are minutes, indexed Sunday through Saturday.
const today = "2026-10-19";
const weekdayLimits = {
	0: 180,
	1: 180,
	2: 180,
	3: 180,
	4: 180,
	5: 180,
	6: 180,
};
const calendar: PlannerCalendar = { today, weekdayLimits, sessions: [] };
const deadline: PlannerDeadline = {
	id: "assignment",
	startDate: today,
	dueDate: "2026-10-23",
	estimateMinutes: 360,
	createdAt: 1,
	status: "active",
};

function session(
	deadlineId: string,
	date: string,
	minutes: number,
	isDone = false,
): PlannerSession {
	return { deadlineId, date, minutes, isDone };
}

function plan(
	remainingMinutes = 360,
	changes: Partial<PlannerCalendar> = {},
	deadlineChanges: Partial<PlannerDeadline> = {},
) {
	return planDeadline({
		...calendar,
		...changes,
		deadline: { ...deadline, ...deadlineChanges, remainingMinutes },
	});
}

describe("planDeadline", () => {
	it("front-loads the PRD's six-hour Monday-to-Friday worked example", () => {
		expect(plan()).toEqual({
			deadlineId: "assignment",
			sessions: [
				{ deadlineId: "assignment", date: today, minutes: 180 },
				{ deadlineId: "assignment", date: "2026-10-20", minutes: 180 },
			],
			shortfallMinutes: 0,
		});
	});

	it("starts today when the start date has passed, and waits for a future start", () => {
		expect(plan(180, {}, { startDate: "2026-10-01" }).sessions[0]?.date).toBe(
			today,
		);
		expect(plan(180, {}, { startDate: "2026-10-21" }).sessions[0]?.date).toBe(
			"2026-10-21",
		);
	});

	it("uses ticked and unticked sessions of other deadlines against capacity", () => {
		const result = plan(180, {
			sessions: [
				session("exam", today, 60, true),
				session("project", today, 60),
			],
		});
		expect(result.sessions).toEqual([
			{ deadlineId: "assignment", date: today, minutes: 60 },
			{ deadlineId: "assignment", date: "2026-10-20", minutes: 120 },
		]);
	});

	it("replaces its own unticked plan without charging it twice", () => {
		expect(
			plan(180, { sessions: [session("assignment", today, 180)] }).sessions,
		).toEqual([{ deadlineId: "assignment", date: today, minutes: 180 }]);
	});

	it("skips the whole date when this deadline already has a ticked session", () => {
		const result = plan(180, {
			sessions: [session("assignment", today, 30, true)],
		});
		expect(result.sessions).toEqual([
			{ deadlineId: "assignment", date: "2026-10-20", minutes: 180 },
		]);
	});

	it("uses the buffer only after earlier days fill, never uses the due date", () => {
		const fits = plan(630);
		expect(fits.sessions.map(({ date, minutes }) => [date, minutes])).toEqual([
			[today, 180],
			["2026-10-20", 180],
			["2026-10-21", 180],
			["2026-10-22", 90],
		]);
		const short = plan(780);
		expect(short.sessions).toHaveLength(4);
		expect(short.sessions.every(({ date }) => date < deadline.dueDate)).toBe(
			true,
		);
		expect(short.shortfallMinutes).toBe(60);
	});

	it("uses a one-day window as its buffer fallback", () => {
		expect(plan(180, {}, { dueDate: "2026-10-20" }).sessions).toEqual([
			{ deadlineId: "assignment", date: today, minutes: 180 },
		]);
	});

	it("reports all remaining minutes when there is no planning window", () => {
		for (const dueDate of [today, "2026-10-18"]) {
			expect(plan(90, {}, { dueDate })).toEqual({
				deadlineId: "assignment",
				sessions: [],
				shortfallMinutes: 90,
			});
		}
	});

	it("returns no sessions or shortfall for completed or over-completed work", () => {
		for (const remaining of [0, -30]) {
			expect(plan(remaining)).toEqual({
				deadlineId: "assignment",
				sessions: [],
				shortfallMinutes: 0,
			});
		}
	});

	it("skips zero-limit weekdays and lets date-specific limits replace defaults", () => {
		const result = plan(240, {
			weekdayLimits: { ...weekdayLimits, 1: 0 },
			daysOff: { "2026-10-20": 0, "2026-10-21": 240 },
		});
		expect(result.sessions).toEqual([
			{ deadlineId: "assignment", date: "2026-10-21", minutes: 240 },
		]);
		// A date override can also make a zero-limit weekday available.
		expect(
			plan(60, {
				weekdayLimits: { ...weekdayLimits, 1: 0 },
				daysOff: { [today]: 60 },
			}).sessions,
		).toEqual([{ deadlineId: "assignment", date: today, minutes: 60 }]);
	});

	it("never places less than 30 minutes or exceeds fractional available space", () => {
		const result = plan(75, {
			weekdayLimits: { ...weekdayLimits, 1: 100, 2: 0, 3: 0, 4: 0 },
			sessions: [session("other", today, 50)],
		});
		expect(result.sessions).toEqual([
			{ deadlineId: "assignment", date: today, minutes: 30 },
		]);
		expect(result.shortfallMinutes).toBe(45);
	});

	it("does not place work on an already over-limit date", () => {
		const result = plan(60, { sessions: [session("other", today, 210)] });
		expect(result.sessions).toEqual([
			{ deadlineId: "assignment", date: "2026-10-20", minutes: 60 },
		]);
	});

	it("uses Sunday=0 weekday limits", () => {
		expect(
			plan(
				90,
				{
					today: "2026-10-25",
					weekdayLimits: { 0: 90 },
				},
				{ startDate: "2026-10-25", dueDate: "2026-10-27" },
			).sessions,
		).toEqual([{ deadlineId: "assignment", date: "2026-10-25", minutes: 90 }]);
	});
});

describe("replanAll", () => {
	it("plans earliest due first with earliest-created tie order", () => {
		const result = replanAll({
			...calendar,
			deadlines: [
				{ ...deadline, id: "later-due", dueDate: "2026-10-24" },
				{ ...deadline, id: "newer", createdAt: new Date(2) },
				{ ...deadline, id: "older", createdAt: new Date(1) },
			],
		});
		expect(result.plans.map(({ deadlineId }) => deadlineId)).toEqual([
			"older",
			"newer",
			"later-due",
		]);
		expect(result.plans[0]?.sessions.map(({ date }) => date)).toEqual([
			today,
			"2026-10-20",
		]);
		expect(result.plans[1]?.sessions.map(({ date }) => date)).toEqual([
			"2026-10-21",
			"2026-10-22",
		]);
		expect(result.plans[2]?.sessions).toEqual([
			{ deadlineId: "later-due", date: "2026-10-23", minutes: 180 },
		]);
		expect(result.plans[2]?.shortfallMinutes).toBe(180);
	});

	it("keeps ticked sessions and replans estimate minus all ticked minutes", () => {
		const result = replanAll({
			...calendar,
			deadlines: [deadline],
			sessions: [
				session("assignment", "2026-10-18", 90, true),
				session("assignment", today, 30, true),
				session("assignment", "2026-10-22", 180),
			],
		});
		expect(result.plans[0]?.sessions).toEqual([
			{ deadlineId: "assignment", date: "2026-10-20", minutes: 180 },
			{ deadlineId: "assignment", date: "2026-10-21", minutes: 60 },
		]);
		expect(result.plans[0]?.shortfallMinutes).toBe(0);
	});

	it("leaves past-due and Done deadlines untouched, retaining their capacity", () => {
		const result = replanAll({
			...calendar,
			deadlines: [
				{ ...deadline, id: "past", dueDate: "2026-10-18" },
				{ ...deadline, id: "done", status: "done" },
				{ ...deadline, estimateMinutes: 180 },
			],
			sessions: [
				session("past", "2026-10-17", 180),
				session("past", today, 60),
				session("done", today, 60, true),
			],
		});
		expect(result.plans).toEqual([
			{
				deadlineId: "assignment",
				sessions: [
					{ deadlineId: "assignment", date: today, minutes: 60 },
					{ deadlineId: "assignment", date: "2026-10-20", minutes: 120 },
				],
				shortfallMinutes: 0,
			},
		]);
	});

	it("removes other Active deadlines' unticked reservations before planning", () => {
		const result = replanAll({
			...calendar,
			deadlines: [
				{ ...deadline, estimateMinutes: 180 },
				{ ...deadline, id: "later", dueDate: "2026-10-24", createdAt: 2 },
			],
			sessions: [session("later", today, 180)],
		});
		expect(result.plans[0]?.sessions).toEqual([
			{ deadlineId: "assignment", date: today, minutes: 180 },
		]);
		expect(result.plans[1]?.sessions[0]?.date).toBe("2026-10-20");
	});

	it("respects start dates and days off across all deadlines", () => {
		const result = replanAll({
			...calendar,
			daysOff: { "2026-10-21": 0 },
			deadlines: [{ ...deadline, startDate: "2026-10-21" }],
		});
		expect(result.plans[0]?.sessions).toEqual([
			{ deadlineId: "assignment", date: "2026-10-22", minutes: 180 },
		]);
		expect(result.plans[0]?.shortfallMinutes).toBe(180);
	});

	it("returns an empty replacement for work already completed beyond its estimate", () => {
		const result = replanAll({
			...calendar,
			deadlines: [{ ...deadline, estimateMinutes: 30 }],
			sessions: [session("assignment", "2026-10-18", 60, true)],
		});
		expect(result.plans).toEqual([
			{ deadlineId: "assignment", sessions: [], shortfallMinutes: 0 },
		]);
	});
});

describe("replanOverdue", () => {
	it("moves only overdue minutes and merges with existing future sessions", () => {
		const result = replanOverdue({
			...calendar,
			deadlines: [deadline, { ...deadline, id: "unaffected" }],
			sessions: [
				session("assignment", "2026-10-16", 60),
				session("assignment", "2026-10-18", 90),
				session("assignment", today, 60),
				session("assignment", "2026-10-21", 60),
				session("unaffected", today, 30),
			],
		});
		expect(result.plans).toEqual([
			{
				deadlineId: "assignment",
				sessions: [
					{ deadlineId: "assignment", date: today, minutes: 150 },
					{ deadlineId: "assignment", date: "2026-10-20", minutes: 60 },
					{ deadlineId: "assignment", date: "2026-10-21", minutes: 60 },
				],
				shortfallMinutes: 0,
			},
		]);
	});

	it("keeps ticked sessions, other deadlines and future reservations in place", () => {
		const result = replanOverdue({
			...calendar,
			deadlines: [deadline],
			sessions: [
				session("assignment", "2026-10-18", 30, true),
				session("assignment", "2026-10-17", 90),
				session("assignment", today, 30, true),
				session("other", "2026-10-20", 180),
				session("assignment", "2026-10-21", 180),
			],
		});
		expect(result.plans[0]?.sessions).toEqual([
			{ deadlineId: "assignment", date: "2026-10-21", minutes: 180 },
			{ deadlineId: "assignment", date: "2026-10-22", minutes: 90 },
		]);
	});

	it("prioritizes soonest due and breaks ties by creation time", () => {
		const result = replanOverdue({
			...calendar,
			deadlines: [
				{ ...deadline, id: "later", dueDate: "2026-10-24" },
				{ ...deadline, id: "newer", createdAt: 3 },
				{ ...deadline, id: "older", createdAt: 2 },
			],
			sessions: [
				session("later", "2026-10-18", 180),
				session("newer", "2026-10-18", 180),
				session("older", "2026-10-18", 180),
			],
		});
		expect(result.plans.map(({ deadlineId }) => deadlineId)).toEqual([
			"older",
			"newer",
			"later",
		]);
		expect(result.plans.map(({ sessions }) => sessions[0]?.date)).toEqual([
			today,
			"2026-10-20",
			"2026-10-21",
		]);
	});

	it("reports shortfall without removing future sessions when no new work fits", () => {
		const result = replanOverdue({
			...calendar,
			deadlines: [{ ...deadline, dueDate: "2026-10-20" }],
			daysOff: { [today]: 0 },
			sessions: [
				session("assignment", "2026-10-18", 90),
				session("assignment", today, 180),
			],
		});
		expect(result.plans[0]).toEqual({
			deadlineId: "assignment",
			sessions: [{ deadlineId: "assignment", date: today, minutes: 180 }],
			shortfallMinutes: 90,
		});
	});

	it("reports all overdue work as shortfall when its deadline has passed", () => {
		const result = replanOverdue({
			...calendar,
			deadlines: [{ ...deadline, dueDate: "2026-10-18" }],
			sessions: [session("assignment", "2026-10-17", 90)],
		});
		expect(result.plans).toEqual([
			{ deadlineId: "assignment", sessions: [], shortfallMinutes: 90 },
		]);
	});

	it("ignores Done deadlines and returns no plans without overdue work", () => {
		expect(
			replanOverdue({
				...calendar,
				deadlines: [{ ...deadline, status: "done" }],
				sessions: [session("assignment", "2026-10-17", 90)],
			}),
		).toEqual({ plans: [] });
		expect(replanOverdue({ ...calendar, deadlines: [deadline] })).toEqual({
			plans: [],
		});
	});
});

describe("calendar arithmetic and purity", () => {
	it("crosses month, leap-day, year and DST boundaries as calendar dates", () => {
		expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
		expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
		expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
		expect(addDays("2026-01-01", -7)).toBe("2025-12-25");
	});

	it("rejects malformed or non-existent calendar dates and non-integer offsets", () => {
		for (const date of ["2026-02-29", "2026-2-01", "2026-13-01", "invalid"]) {
			expect(() => addDays(date, 1)).toThrow(RangeError);
		}
		expect(() => addDays(today, 0.5)).toThrow(RangeError);
	});

	it("plans through a leap day and across a year boundary", () => {
		expect(
			plan(
				540,
				{ today: "2028-02-28" },
				{ startDate: "2028-02-28", dueDate: "2028-03-02" },
			).sessions.map(({ date }) => date),
		).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
		expect(
			plan(
				360,
				{ today: "2026-12-31" },
				{ startDate: "2026-12-31", dueDate: "2027-01-02" },
			).sessions.map(({ date }) => date),
		).toEqual(["2026-12-31", "2027-01-01"]);
	});

	it("does not mutate caller-owned deadlines, sessions or limits", () => {
		const input = {
			...calendar,
			deadlines: [{ ...deadline }],
			sessions: [
				session("assignment", "2026-10-18", 90),
				session("assignment", today, 30),
			],
			daysOff: { "2026-10-21": 0 },
		};
		const original = structuredClone(input);
		replanAll(input);
		replanOverdue(input);
		planDeadline({
			...input,
			deadline: { ...deadline, remainingMinutes: 180 },
		});
		expect(input).toEqual(original);
	});
});

it("replans 50 Active deadlines with 200 sessions in under 50 ms", () => {
	const deadlines = Array.from({ length: 50 }, (_, index) => ({
		...deadline,
		id: `deadline-${index}`,
		estimateMinutes: 6000,
		dueDate: addDays(today, 30 + index),
		createdAt: index,
	}));
	const sessions = Array.from({ length: 200 }, (_, index) =>
		session(
			`deadline-${index % 50}`,
			addDays(today, Math.floor(index / 50) - 2),
			60,
			index < 50,
		),
	);
	const input = { ...calendar, deadlines, sessions };
	// Warm the function before timing; this measures replanning, not module load.
	replanAll(input);
	const started = performance.now();
	const result = replanAll(input);
	const elapsed = performance.now() - started;
	expect(result.plans).toHaveLength(50);
	expect(
		result.plans.some(({ shortfallMinutes }) => shortfallMinutes > 0),
	).toBe(true);
	expect(elapsed).toBeLessThan(50);
});
