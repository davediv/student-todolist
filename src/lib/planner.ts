/** Calendar dates are ISO YYYY-MM-DD strings; all durations are minutes. */
export type CalendarDate = string;

export interface PlannerSession {
	deadlineId: string;
	date: CalendarDate;
	minutes: number;
	isDone: boolean;
}

export interface PlannedSession {
	deadlineId: string;
	date: CalendarDate;
	minutes: number;
}

export interface PlannerDeadline {
	id: string;
	startDate: CalendarDate;
	dueDate: CalendarDate;
	estimateMinutes: number;
	createdAt: number | Date;
	status?: "active" | "done";
}

export interface PlannerCalendar {
	today: CalendarDate;
	/** JavaScript weekday numbers: Sunday = 0, Monday = 1, ..., Saturday = 6. */
	weekdayLimits: Readonly<Record<number, number>>;
	/** A date-specific limit replaces its weekday limit, including a zero limit. */
	daysOff?: Readonly<Record<CalendarDate, number>>;
	sessions: readonly PlannerSession[];
}

export interface DeadlinePlan {
	deadlineId: string;
	sessions: PlannedSession[];
	shortfallMinutes: number;
}

export interface ReplanInput extends PlannerCalendar {
	deadlines: readonly PlannerDeadline[];
}

export interface ReplanResult {
	plans: DeadlinePlan[];
}

export interface PlanDeadlineInput extends PlannerCalendar {
	deadline: Pick<PlannerDeadline, "id" | "startDate" | "dueDate"> & {
		remainingMinutes: number;
	};
}

const DAY_MS = 86_400_000;
const SESSION_STEP = 30;

function calendarDay(date: CalendarDate): number {
	const time = Date.parse(`${date}T00:00:00.000Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
		!Number.isFinite(time) ||
		new Date(time).toISOString().slice(0, 10) !== date
	) {
		throw new RangeError(`Invalid calendar date: ${date}`);
	}
	return time / DAY_MS;
}

function dateFromDay(day: number): CalendarDate {
	const date = new Date(day * DAY_MS).toISOString();
	if (!/^\d{4}-/.test(date)) {
		throw new RangeError("Calendar date is outside the supported year range");
	}
	return date.slice(0, 10);
}

/** Uses UTC only as a calendar counter, avoiding local time and DST changes. */
export function addDays(date: CalendarDate, amount: number): CalendarDate {
	if (!Number.isInteger(amount)) {
		throw new RangeError("Calendar day offsets must be integers");
	}
	return dateFromDay(calendarDay(date) + amount);
}

function compareDeadlines(a: PlannerDeadline, b: PlannerDeadline): number {
	return (
		a.dueDate.localeCompare(b.dueDate) ||
		Number(a.createdAt) - Number(b.createdAt)
	);
}

function indexSessions(sessions: readonly PlannerSession[]) {
	const usedMinutes = new Map<CalendarDate, number>();
	const tickedDates = new Map<string, Set<CalendarDate>>();
	for (const session of sessions) {
		usedMinutes.set(
			session.date,
			(usedMinutes.get(session.date) ?? 0) + session.minutes,
		);
		if (session.isDone) {
			let dates = tickedDates.get(session.deadlineId);
			if (!dates) {
				dates = new Set();
				tickedDates.set(session.deadlineId, dates);
			}
			dates.add(session.date);
		}
	}
	return { usedMinutes, tickedDates };
}

type SessionIndex = ReturnType<typeof indexSessions>;

function allocate(
	deadline: PlanDeadlineInput["deadline"],
	calendar: PlannerCalendar,
	index: SessionIndex,
): DeadlinePlan {
	const sessions: PlannedSession[] = [];
	let remaining = Math.max(0, deadline.remainingMinutes);
	if (remaining === 0) {
		return { deadlineId: deadline.id, sessions, shortfallMinutes: 0 };
	}
	const firstDay = calendarDay(
		deadline.startDate > calendar.today ? deadline.startDate : calendar.today,
	);
	const dueDay = calendarDay(deadline.dueDate);
	const tickedDates = index.tickedDates.get(deadline.id);

	// Walking forward naturally leaves the buffer day empty whenever earlier
	// dates can hold the work; the buffer is used only as the final fallback.
	for (let day = firstDay; day < dueDay && remaining >= SESSION_STEP; day++) {
		const date = dateFromDay(day);
		if (tickedDates?.has(date)) continue;
		const limit =
			calendar.daysOff?.[date] ??
			calendar.weekdayLimits[new Date(day * DAY_MS).getUTCDay()] ??
			0;
		const used = index.usedMinutes.get(date) ?? 0;
		const capacity = Math.max(0, limit - used);
		const minutes =
			Math.floor(Math.min(remaining, capacity) / SESSION_STEP) * SESSION_STEP;
		if (minutes === 0) continue;
		sessions.push({ deadlineId: deadline.id, date, minutes });
		index.usedMinutes.set(date, used + minutes);
		remaining -= minutes;
	}
	return { deadlineId: deadline.id, sessions, shortfallMinutes: remaining };
}

/**
 * Produces a fresh plan for the given remaining work. Existing unticked
 * sessions for this deadline are replaced; its ticked sessions stay in place.
 * Other deadlines' ticked and unticked sessions both consume capacity.
 */
export function planDeadline(input: PlanDeadlineInput): DeadlinePlan {
	const keptSessions = input.sessions.filter(
		(session) => session.deadlineId !== input.deadline.id || session.isDone,
	);
	return allocate(input.deadline, input, indexSessions(keptSessions));
}

/**
 * Returns replacements for unticked sessions of Active, non-past-due
 * deadlines. Ticked sessions, Done deadlines and past-due deadlines stay put.
 * Callers retain those sessions and replace only deadlines named in `plans`.
 */
export function replanAll(input: ReplanInput): ReplanResult {
	const deadlines = input.deadlines
		.filter(
			(deadline) =>
				deadline.status !== "done" && deadline.dueDate >= input.today,
		)
		.sort(compareDeadlines);
	const replannedIds = new Set(deadlines.map((deadline) => deadline.id));
	const index = indexSessions(
		input.sessions.filter(
			(session) => session.isDone || !replannedIds.has(session.deadlineId),
		),
	);
	const tickedMinutes = new Map<string, number>();
	for (const session of input.sessions) {
		if (session.isDone) {
			tickedMinutes.set(
				session.deadlineId,
				(tickedMinutes.get(session.deadlineId) ?? 0) + session.minutes,
			);
		}
	}
	return {
		plans: deadlines.map((deadline) =>
			allocate(
				{
					...deadline,
					remainingMinutes:
						deadline.estimateMinutes - (tickedMinutes.get(deadline.id) ?? 0),
				},
				input,
				index,
			),
		),
	};
}

/**
 * Returns replacements for affected deadlines' unticked sessions. Existing
 * sessions from today onward keep their dates and minutes, with overdue work
 * merged into them when capacity permits. All other deadlines and all ticked
 * sessions stay untouched. A deadline without remaining days reports shortfall.
 */
export function replanOverdue(input: ReplanInput): ReplanResult {
	const activeIds = new Set(
		input.deadlines
			.filter((deadline) => deadline.status !== "done")
			.map((deadline) => deadline.id),
	);
	const overdueMinutes = new Map<string, number>();
	const futureSessions = new Map<string, Map<CalendarDate, PlannedSession>>();
	const keptSessions: PlannerSession[] = [];
	for (const session of input.sessions) {
		if (
			activeIds.has(session.deadlineId) &&
			!session.isDone &&
			session.date < input.today
		) {
			overdueMinutes.set(
				session.deadlineId,
				(overdueMinutes.get(session.deadlineId) ?? 0) + session.minutes,
			);
		} else {
			keptSessions.push(session);
			if (!session.isDone && session.date >= input.today) {
				let byDate = futureSessions.get(session.deadlineId);
				if (!byDate) {
					byDate = new Map();
					futureSessions.set(session.deadlineId, byDate);
				}
				byDate.set(session.date, {
					deadlineId: session.deadlineId,
					date: session.date,
					minutes: (byDate.get(session.date)?.minutes ?? 0) + session.minutes,
				});
			}
		}
	}
	const index = indexSessions(keptSessions);
	const deadlines = input.deadlines
		.filter((deadline) => overdueMinutes.has(deadline.id))
		.sort(compareDeadlines);
	return {
		plans: deadlines.map((deadline) => {
			const plan = allocate(
				{
					...deadline,
					remainingMinutes: overdueMinutes.get(deadline.id) ?? 0,
				},
				input,
				index,
			);
			const byDate = futureSessions.get(deadline.id) ?? new Map();
			for (const session of plan.sessions) {
				byDate.set(session.date, {
					...session,
					minutes: (byDate.get(session.date)?.minutes ?? 0) + session.minutes,
				});
			}
			return {
				...plan,
				sessions: [...byDate.values()].sort((a, b) =>
					a.date.localeCompare(b.date),
				),
			};
		}),
	};
}
