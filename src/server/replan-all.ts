import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { getDb } from "#/db";
import { deadlines, studySessions } from "#/db/schema";
import { deadlineSchema } from "#/lib/deadlines";
import { replanAll } from "#/lib/planner";
import type { ReplanAllRequest } from "#/lib/replan-all-query";
import {
	commitPlan,
	PlanConflict,
	planningState,
	weekdayLimits,
} from "./planning-state";
import type { ApiEnv } from "./types";

async function prepare(c: Context<ApiEnv>) {
	const parsed = z
		.object({
			previewVersion: z
				.object({
					revision: z.number().int().nonnegative(),
					today: z.iso.date(),
				})
				.optional(),
			pending: z
				.object({
					id: z.string().min(1).optional(),
					input: deadlineSchema("0000-00-00"),
				})
				.optional(),
		})
		.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success)
		return {
			error: c.json(
				{
					error: { code: "validation", message: "Check your pending deadline" },
				},
				400,
			),
		};
	const db = getDb(c.env);
	const userId = c.get("user").id;
	const pending = parsed.data.pending;
	if (pending?.id) {
		const owned = await db.query.deadlines.findFirst({
			where: and(eq(deadlines.id, pending.id), eq(deadlines.userId, userId)),
		});
		if (!owned)
			return {
				error: c.json(
					{ error: { code: "not_found", message: "Deadline not found" } },
					404,
				),
			};
		if (owned.status === "done")
			return {
				error: c.json(
					{
						error: {
							code: "deadline_done",
							message: "Done deadlines cannot be edited",
						},
					},
					409,
				),
			};
	}
	const state = await planningState(db, userId);
	const previewVersion = parsed.data.previewVersion;
	if (
		previewVersion &&
		(previewVersion.revision !== state.revision ||
			previewVersion.today !== c.get("today"))
	)
		throw new PlanConflict();
	if (
		pending &&
		!deadlineSchema(c.get("today")).safeParse(pending.input).success
	)
		return {
			error: c.json(
				{
					error: { code: "validation", message: "Check your pending deadline" },
				},
				400,
			),
		};
	if (pending?.id) {
		const current = state.deadlines.find((item) => item.id === pending.id);
		if (!current)
			return {
				error: c.json(
					{ error: { code: "not_found", message: "Deadline not found" } },
					404,
				),
			};
		if (current.status === "done")
			return {
				error: c.json(
					{
						error: {
							code: "deadline_done",
							message: "Done deadlines cannot be edited",
						},
					},
					409,
				),
			};
	}
	const items = state.deadlines.map((item) =>
		item.id === pending?.id ? { ...item, ...pending.input } : item,
	);
	if (pending && !pending.id)
		items.push({
			...pending.input,
			id: "pending-new",
			userId,
			status: "active",
			createdAt: new Date(),
			doneAt: null,
		});
	const result = replanAll({
		today: c.get("today"),
		deadlines: items,
		weekdayLimits: weekdayLimits(state.limits),
		daysOff: state.daysOff,
		sessions: state.sessions.map((row) => ({ ...row, isDone: row.ticked })),
	});
	const plans = result.plans.map((plan) => {
		const item = items.find((item) => item.id === plan.deadlineId);
		if (!item) throw new Error("Deadline missing from plan");
		return {
			deadlineId: item.id,
			title: item.title,
			dueDate: item.dueDate,
			sessions: plan.sessions.map(({ date, minutes }) => ({ date, minutes })),
			keptSessions: state.sessions
				.filter((row) => row.deadlineId === item.id && row.ticked)
				.sort((a, b) => a.date.localeCompare(b.date))
				.map(({ id, date, minutes }) => ({ id, date, minutes })),
			shortfallMinutes: plan.shortfallMinutes,
		};
	});
	return {
		db,
		userId,
		revision: state.revision,
		plans,
		pending,
		previewVersion: { revision: state.revision, today: c.get("today") },
	};
}

export const replanAllRoutes = new Hono<ApiEnv>()
	.post(
		"/replan/all/preview",
		validator("json", (value) => value as ReplanAllRequest),
		async (c) => {
			const result = await prepare(c);
			if (result.error) return result.error;
			return c.json({
				plans: result.plans,
				previewVersion: result.previewVersion,
			});
		},
	)
	.post(
		"/replan/all",
		validator("json", (value) => value as ReplanAllRequest),
		async (c) => {
			const result = await prepare(c);
			if (result.error) return result.error;
			const { db, userId, revision, plans, pending } = result;
			const pendingDeadlineId = pending
				? (pending.id ?? crypto.randomUUID())
				: null;
			const queries: Parameters<typeof commitPlan>[3] = [];
			if (pending && pendingDeadlineId) {
				queries.push(
					pending.id
						? db
								.update(deadlines)
								.set(pending.input)
								.where(
									and(
										eq(deadlines.id, pending.id),
										eq(deadlines.userId, userId),
									),
								)
						: db.insert(deadlines).values({
								...pending.input,
								id: pendingDeadlineId,
								userId,
							}),
				);
			}
			for (const plan of plans) {
				const id =
					plan.deadlineId === "pending-new" && pendingDeadlineId
						? pendingDeadlineId
						: plan.deadlineId;
				queries.push(
					db
						.delete(studySessions)
						.where(
							and(
								eq(studySessions.userId, userId),
								eq(studySessions.deadlineId, id),
								eq(studySessions.ticked, false),
							),
						),
					...plan.sessions.map((session) =>
						db.insert(studySessions).values({
							...session,
							id: crypto.randomUUID(),
							userId,
							deadlineId: id,
						}),
					),
				);
			}
			if (queries.length) await commitPlan(db, userId, revision, queries);
			return c.json({
				plans,
				pendingDeadlineId,
				previewVersion: result.previewVersion,
			});
		},
	);
