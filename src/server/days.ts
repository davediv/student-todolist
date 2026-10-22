import {
	and,
	asc,
	eq,
	getTableColumns,
	gte,
	isNull,
	lte,
	or,
} from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "#/db";
import {
	daysOff,
	deadlines,
	studyLimits,
	studySessions,
	todos,
} from "#/db/schema";
import { addDays } from "#/lib/planner";
import { weekdayLimits } from "./planning-state";
import type { ApiEnv } from "./types";

export const daysRoutes = new Hono<ApiEnv>().get("/days", async (c) => {
	const parsed = z
		.object({ from: z.iso.date(), to: z.iso.date() })
		.safeParse(c.req.query());
	if (
		!parsed.success ||
		parsed.data.to < parsed.data.from ||
		(Date.parse(parsed.data.to) - Date.parse(parsed.data.from)) / 86_400_000 >=
			31
	)
		return c.json(
			{
				error: {
					code: "validation",
					message: "Choose a date range of 1 to 31 days",
				},
			},
			400,
		);
	const { from, to } = parsed.data;
	const db = getDb(c.env);
	const userId = c.get("user").id;
	const limits = await db.query.studyLimits.findFirst({
		where: eq(studyLimits.userId, userId),
	});
	if (!limits)
		return c.json(
			{
				error: {
					code: "limits_required",
					message: "Set study limits before planning",
				},
			},
			409,
		);
	const sessions = await db
		.select({
			...getTableColumns(studySessions),
			title: deadlines.title,
			type: deadlines.type,
			dueDate: deadlines.dueDate,
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
				gte(studySessions.date, from),
				lte(studySessions.date, to),
			),
		)
		.orderBy(
			asc(studySessions.date),
			asc(deadlines.dueDate),
			asc(deadlines.createdAt),
			asc(studySessions.id),
		);
	const byDate = new Map<string, typeof sessions>();
	for (const session of sessions) {
		const group = byDate.get(session.date) ?? [];
		group.push(session);
		byDate.set(session.date, group);
	}
	const visibleTodos = await db
		.select()
		.from(todos)
		.where(
			and(
				eq(todos.userId, userId),
				or(eq(todos.done, false), eq(todos.doneOn, c.get("today"))),
				or(and(gte(todos.date, from), lte(todos.date, to)), isNull(todos.date)),
			),
		)
		.orderBy(asc(todos.createdAt), asc(todos.id));
	const weekdays = weekdayLimits(limits);
	const overrides = await db
		.select()
		.from(daysOff)
		.where(
			and(
				eq(daysOff.userId, userId),
				gte(daysOff.date, from),
				lte(daysOff.date, to),
			),
		);
	const byDayOff = new Map(
		overrides.map((row) => [row.date, row.limitMinutes]),
	);
	const days = [];
	for (let date = from; date <= to; ) {
		const daySessions = byDate.get(date) ?? [];
		const plannedMinutes = daySessions.reduce(
			(sum, session) => sum + session.minutes,
			0,
		);
		const limitMinutes =
			byDayOff.get(date) ??
			weekdays[
				new Date(`${date}T00:00:00Z`).getUTCDay() as keyof typeof weekdays
			];
		days.push({
			date,
			isDayOff: byDayOff.has(date),
			limitMinutes,
			plannedMinutes,
			overLimit: plannedMinutes > limitMinutes,
			sessions: daySessions,
			todos: visibleTodos.filter((todo) => todo.date === date),
		});
		if (date === to) break;
		date = addDays(date, 1);
	}
	return c.json({
		days,
		anytime: visibleTodos.filter((todo) => todo.date === null),
	});
});
