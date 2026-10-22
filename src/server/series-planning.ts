import { sql } from "drizzle-orm";
import type { getDb } from "#/db";
import { deadlines, studySessions } from "#/db/schema";
import { planDeadline } from "#/lib/planner";
import { type planningState, weekdayLimits } from "./planning-state";

type State = Awaited<ReturnType<typeof planningState>>;
type Occurrence = Pick<
	typeof deadlines.$inferSelect,
	"id" | "dueDate" | "startDate" | "estimateMinutes"
>;

export function planSeriesOccurrences(
	state: State,
	occurrences: Occurrence[],
	today: string,
) {
	const ids = new Set(occurrences.map((row) => row.id));
	const reserved = state.sessions
		.filter((row) => row.ticked || !ids.has(row.deadlineId))
		.map((row) => ({ ...row, isDone: row.ticked }));
	return [...occurrences]
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
		.map((row) => {
			const keptSessions = state.sessions
				.filter((session) => session.deadlineId === row.id && session.ticked)
				.sort((a, b) => a.date.localeCompare(b.date));
			const plan = planDeadline({
				today,
				weekdayLimits: weekdayLimits(state.limits),
				daysOff: state.daysOff,
				sessions: reserved,
				deadline: {
					...row,
					remainingMinutes: Math.max(
						0,
						row.estimateMinutes -
							keptSessions.reduce((sum, session) => sum + session.minutes, 0),
					),
				},
			});
			reserved.push(
				...plan.sessions.map((session) => ({
					...session,
					id: "",
					userId: "",
					ticked: false,
					tickedAt: null,
					isDone: false,
				})),
			);
			return {
				id: row.id,
				dueDate: row.dueDate,
				startDate: row.startDate,
				sessions: plan.sessions.map(({ date, minutes }) => ({ date, minutes })),
				keptSessions,
				shortfallMinutes: plan.shortfallMinutes,
			};
		});
}

// JSON table-valued inserts keep year-long series below D1's bind/query limits.
export function insertSeriesDeadlines(
	db: ReturnType<typeof getDb>,
	rows: (typeof deadlines.$inferInsert)[],
) {
	return db.insert(deadlines).select(sql`select
	 json_extract(value,'$.id'), json_extract(value,'$.userId'), json_extract(value,'$.title'), json_extract(value,'$.type'), json_extract(value,'$.seriesId'), json_extract(value,'$.dueDate'), json_extract(value,'$.startDate'), json_extract(value,'$.estimateMinutes'), coalesce(json_extract(value,'$.notes'),''), 'active', null, json_extract(value,'$.createdAt')
	 from json_each(${JSON.stringify(rows.map((row) => ({ ...row, createdAt: Number(row.createdAt ?? new Date()) })))})`);
}
export function insertSeriesSessions(
	db: ReturnType<typeof getDb>,
	rows: (typeof studySessions.$inferInsert)[],
) {
	return db.insert(studySessions).select(sql`select
	 json_extract(value,'$.id'), json_extract(value,'$.userId'), json_extract(value,'$.deadlineId'), json_extract(value,'$.date'), json_extract(value,'$.minutes'), 0, null
	 from json_each(${JSON.stringify(rows)})`);
}
