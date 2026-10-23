import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "#/db";
import { deadlines, studySessions } from "#/db/schema";
import { recentWeeks, weekStart } from "#/lib/week";
import type { ApiEnv } from "./types";

export const statsRoutes = new Hono<ApiEnv>().get(
	"/stats/weekly",
	async (c) => {
		const weeks = recentWeeks(c.get("today")).map((week) => ({
			...week,
			doneMinutes: 0,
			plannedMinutes: 0,
		}));
		const userId = c.get("user").id;
		const totals = await getDb(c.env)
			.select({
				date: studySessions.date,
				doneMinutes:
					sql<number>`sum(case when ${studySessions.ticked} then ${studySessions.minutes} else 0 end)`.mapWith(
						Number,
					),
				plannedMinutes: sql<number>`sum(${studySessions.minutes})`.mapWith(
					Number,
				),
			})
			.from(studySessions)
			.innerJoin(
				deadlines,
				and(
					eq(studySessions.deadlineId, deadlines.id),
					eq(deadlines.userId, userId),
				),
			)
			.where(
				and(
					eq(studySessions.userId, userId),
					gte(studySessions.date, weeks[3].startDate),
					lte(studySessions.date, weeks[0].endDate),
				),
			)
			.groupBy(studySessions.date);
		const byWeek = new Map(weeks.map((week) => [week.startDate, week]));
		for (const total of totals) {
			const week = byWeek.get(weekStart(total.date));
			if (week) {
				week.doneMinutes += total.doneMinutes;
				week.plannedMinutes += total.plannedMinutes;
			}
		}
		return c.json({ weeks });
	},
);
