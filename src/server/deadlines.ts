import { and, asc, eq, getTableColumns, gte, lt, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { getDb } from "#/db";
import { deadlines, studyLimits, studySessions } from "#/db/schema";
import { deadlineSchema } from "#/lib/deadlines";
import { planDeadline } from "#/lib/planner";
import type { ApiEnv } from "./types";

async function preparePlan(c: Context<ApiEnv>) {
	const parsed = deadlineSchema(c.get("today")).safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success)
		return {
			error: c.json(
				{
					error: {
						code: "validation",
						message: "Check your deadline",
						fields: parsed.error.flatten().fieldErrors,
					},
				},
				400,
			),
		};
	const db = getDb(c.env);
	const userId = c.get("user").id;
	const limits = await db.query.studyLimits.findFirst({
		where: eq(studyLimits.userId, userId),
	});
	if (!limits)
		return {
			error: c.json(
				{
					error: {
						code: "limits_required",
						message: "Set study limits before planning",
					},
				},
				409,
			),
		};
	const existing = await db
		.select()
		.from(studySessions)
		.where(
			and(
				eq(studySessions.userId, userId),
				gte(studySessions.date, c.get("today")),
				lt(studySessions.date, parsed.data.dueDate),
			),
		);
	const plan = planDeadline({
		deadline: {
			id: "preview",
			...parsed.data,
			remainingMinutes: parsed.data.estimateMinutes,
		},
		today: c.get("today"),
		weekdayLimits: {
			0: limits.sunday,
			1: limits.monday,
			2: limits.tuesday,
			3: limits.wednesday,
			4: limits.thursday,
			5: limits.friday,
			6: limits.saturday,
		},
		sessions: existing.map((row) => ({ ...row, isDone: row.ticked })),
	});
	return {
		data: parsed.data,
		plan: {
			sessions: plan.sessions.map(({ date, minutes }) => ({ date, minutes })),
			shortfallMinutes: plan.shortfallMinutes,
		},
	};
}
function summaryQuery(db: ReturnType<typeof getDb>, userId: string) {
	return db
		.select({
			...getTableColumns(deadlines),
			tickedMinutes:
				sql<number>`coalesce(sum(case when ${studySessions.ticked} then ${studySessions.minutes} else 0 end),0)`.mapWith(
					Number,
				),
			plannedMinutes:
				sql<number>`coalesce(sum(${studySessions.minutes}),0)`.mapWith(Number),
		})
		.from(deadlines)
		.leftJoin(
			studySessions,
			and(
				eq(studySessions.deadlineId, deadlines.id),
				eq(studySessions.userId, userId),
			),
		)
		.where(and(eq(deadlines.userId, userId), eq(deadlines.status, "active")))
		.groupBy(deadlines.id)
		.orderBy(asc(deadlines.dueDate), asc(deadlines.createdAt));
}
export const deadlinesRoutes = new Hono<ApiEnv>()
	.post("/deadlines/preview", async (c) => {
		const result = await preparePlan(c);
		if (result.error) return result.error;
		return c.json(result.plan);
	})
	.post("/deadlines", async (c) => {
		const result = await preparePlan(c);
		if (result.error) return result.error;
		const db = getDb(c.env);
		const deadline = {
			id: crypto.randomUUID(),
			userId: c.get("user").id,
			...result.data,
			status: "active" as const,
			createdAt: new Date(),
			doneAt: null,
		};
		// D1 batches commit the deadline and every session atomically. Each insert
		// stays below D1's per-statement parameter limit, even for a 200-day plan.
		await db.batch([
			db.insert(deadlines).values(deadline),
			...result.plan.sessions.map((session) =>
				db.insert(studySessions).values({
					...session,
					id: crypto.randomUUID(),
					userId: deadline.userId,
					deadlineId: deadline.id,
				}),
			),
		]);
		return c.json(
			{
				deadline: {
					...deadline,
					tickedMinutes: 0,
					plannedMinutes:
						deadline.estimateMinutes - result.plan.shortfallMinutes,
					unplannedMinutes: result.plan.shortfallMinutes,
				},
				...result.plan,
			},
			201,
		);
	})
	.get("/deadlines", async (c) => {
		const rows = await summaryQuery(getDb(c.env), c.get("user").id);
		return c.json(
			rows.map((row) => ({
				...row,
				unplannedMinutes: Math.max(0, row.estimateMinutes - row.plannedMinutes),
			})),
		);
	})
	.get("/deadlines/:id", async (c) => {
		const db = getDb(c.env);
		const userId = c.get("user").id;
		const deadline = await db.query.deadlines.findFirst({
			where: and(
				eq(deadlines.id, c.req.param("id")),
				eq(deadlines.userId, userId),
			),
		});
		if (!deadline)
			return c.json(
				{ error: { code: "not_found", message: "Deadline not found" } },
				404,
			);
		const sessions = await db
			.select()
			.from(studySessions)
			.where(
				and(
					eq(studySessions.deadlineId, deadline.id),
					eq(studySessions.userId, userId),
				),
			)
			.orderBy(asc(studySessions.date));
		const plannedMinutes = sessions.reduce((sum, row) => sum + row.minutes, 0);
		const tickedMinutes = sessions.reduce(
			(sum, row) => sum + (row.ticked ? row.minutes : 0),
			0,
		);
		return c.json({
			deadline: {
				...deadline,
				plannedMinutes,
				tickedMinutes,
				unplannedMinutes: Math.max(
					0,
					deadline.estimateMinutes - plannedMinutes,
				),
			},
			sessions,
		});
	});
