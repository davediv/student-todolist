import { and, asc, eq, gte, lt } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "#/db";
import { deadlines, studySessions } from "#/db/schema";
import { replanOverdue } from "#/lib/planner";
import { commitPlan, planningState, weekdayLimits } from "./planning-state";
import type { ApiEnv } from "./types";
export const overdueRoutes = new Hono<ApiEnv>()
	.get("/overdue", async (c) => {
		const rows = await getDb(c.env)
			.select({
				id: studySessions.id,
				deadlineId: studySessions.deadlineId,
				userId: studySessions.userId,
				date: studySessions.date,
				minutes: studySessions.minutes,
				ticked: studySessions.ticked,
				tickedAt: studySessions.tickedAt,
				title: deadlines.title,
				type: deadlines.type,
				dueDate: deadlines.dueDate,
			})
			.from(studySessions)
			.innerJoin(
				deadlines,
				and(
					eq(deadlines.id, studySessions.deadlineId),
					eq(deadlines.userId, c.get("user").id),
				),
			)
			.where(
				and(
					eq(studySessions.userId, c.get("user").id),
					eq(studySessions.ticked, false),
					lt(studySessions.date, c.get("today")),
					eq(deadlines.status, "active"),
					gte(deadlines.dueDate, c.get("today")),
				),
			)
			.orderBy(asc(deadlines.dueDate), asc(studySessions.date));
		return c.json({ sessions: rows });
	})
	.post("/replan/overdue", async (c) => {
		const db = getDb(c.env),
			userId = c.get("user").id,
			today = c.get("today");
		const state = await planningState(db, userId);
		const items = state.deadlines.filter(
			(item) => item.status === "active" && item.dueDate >= today,
		);
		const result = replanOverdue({
			today,
			deadlines: items,
			weekdayLimits: weekdayLimits(state.limits),
			sessions: state.sessions.map((row) => ({ ...row, isDone: row.ticked })),
		});
		const queries: Parameters<typeof commitPlan>[3] = [];
		const plans = result.plans.map((plan) => {
			const item = items.find((item) => item.id === plan.deadlineId);
			if (!item) throw new Error("Deadline missing from plan");
			const old = state.sessions.filter(
				(row) => row.deadlineId === item.id && !row.ticked && row.date < today,
			);
			for (const row of old)
				queries.push(
					db
						.delete(studySessions)
						.where(
							and(
								eq(studySessions.id, row.id),
								eq(studySessions.userId, userId),
							),
						),
				);
			const moved: { date: string; minutes: number }[] = [];
			for (const session of plan.sessions) {
				const existing = state.sessions.find(
					(row) =>
						row.deadlineId === item.id &&
						!row.ticked &&
						row.date === session.date,
				);
				const added = session.minutes - (existing?.minutes ?? 0);
				if (added <= 0) continue;
				moved.push({ date: session.date, minutes: added });
				if (existing)
					queries.push(
						db
							.update(studySessions)
							.set({ minutes: session.minutes })
							.where(
								and(
									eq(studySessions.id, existing.id),
									eq(studySessions.userId, userId),
								),
							),
					);
				else
					queries.push(
						db.insert(studySessions).values({
							id: crypto.randomUUID(),
							userId,
							deadlineId: item.id,
							date: session.date,
							minutes: session.minutes,
						}),
					);
			}
			return {
				deadlineId: item.id,
				title: item.title,
				moved,
				movedMinutes: moved.reduce((sum, row) => sum + row.minutes, 0),
				shortfallMinutes: plan.shortfallMinutes,
			};
		});
		if (queries.length) await commitPlan(db, userId, state.revision, queries);
		return c.json({ plans });
	});
