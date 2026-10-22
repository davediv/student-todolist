import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { getDb } from "#/db";
import { deadlines, studySessions } from "#/db/schema";
import { type DeadlineInput, deadlineSchema } from "#/lib/deadlines";
import { planDeadline } from "#/lib/planner";
import {
	commitPlan,
	PlanConflict,
	planningState,
	weekdayLimits,
} from "./planning-state";
import type { ApiEnv } from "./types";

type DeadlineEditInput = Partial<DeadlineInput> & {
	previewVersion?: { revision: number; today: string };
};

async function prepareEdit(c: Context<ApiEnv>) {
	const db = getDb(c.env);
	const userId = c.get("user").id;
	const id = c.req.param("id") ?? "";
	// Check ownership even when this account has not configured study limits.
	const owned = await db.query.deadlines.findFirst({
		where: and(eq(deadlines.id, id), eq(deadlines.userId, userId)),
	});
	if (!owned)
		return {
			error: c.json(
				{ error: { code: "not_found", message: "Deadline not found" } },
				404,
			),
		};
	const state = await planningState(db, userId);
	const deadline = state.deadlines.find((row) => row.id === id);
	if (!deadline)
		return {
			error: c.json(
				{ error: { code: "not_found", message: "Deadline not found" } },
				404,
			),
		};
	if (deadline.status === "done")
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
	const shape = deadlineSchema("0000-00-00").shape;
	const patch = z
		.object({
			title: shape.title.optional(),
			type: shape.type.optional(),
			notes: z.string().optional(),
			dueDate: shape.dueDate.optional(),
			startDate: shape.startDate.optional(),
			estimateMinutes: shape.estimateMinutes.optional(),
			previewVersion: z
				.object({
					revision: z.number().int().nonnegative(),
					today: z.iso.date(),
				})
				.optional(),
		})
		.safeParse(await c.req.json().catch(() => null));
	if (!patch.success)
		return {
			error: c.json(
				{
					error: {
						code: "validation",
						message: "Check your deadline",
						fields: patch.error.flatten().fieldErrors,
					},
				},
				400,
			),
		};
	const { previewVersion, ...changes } = patch.data;
	if (
		previewVersion &&
		(previewVersion.revision !== state.revision ||
			previewVersion.today !== c.get("today"))
	)
		throw new PlanConflict();
	const merged = { ...deadline, ...changes };
	const planningChanged =
		merged.dueDate !== deadline.dueDate ||
		merged.startDate !== deadline.startDate ||
		merged.estimateMinutes !== deadline.estimateMinutes;
	const parsed = deadlineSchema(
		planningChanged ? c.get("today") : "0000-00-00",
	).safeParse(merged);
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
	const ownSessions = state.sessions.filter((row) => row.deadlineId === id);
	const keptSessions = ownSessions
		.filter((row) => row.ticked)
		.sort((a, b) => a.date.localeCompare(b.date));
	const plan = planningChanged
		? planDeadline({
				deadline: {
					...parsed.data,
					id,
					remainingMinutes: Math.max(
						0,
						parsed.data.estimateMinutes -
							keptSessions.reduce((sum, row) => sum + row.minutes, 0),
					),
				},
				today: c.get("today"),
				weekdayLimits: weekdayLimits(state.limits),
				daysOff: state.daysOff,
				sessions: state.sessions.map((row) => ({ ...row, isDone: row.ticked })),
			})
		: {
				sessions: ownSessions.filter((row) => !row.ticked),
				shortfallMinutes: Math.max(
					0,
					parsed.data.estimateMinutes -
						ownSessions.reduce((sum, row) => sum + row.minutes, 0),
				),
			};
	return {
		db,
		userId,
		revision: state.revision,
		deadline,
		data: parsed.data,
		planningChanged,
		plan: {
			sessions: plan.sessions.map(({ date, minutes }) => ({ date, minutes })),
			keptSessions,
			shortfallMinutes: plan.shortfallMinutes,
		},
	};
}

export const deadlineEditRoutes = new Hono<ApiEnv>()
	.post(
		"/deadlines/:id/preview",
		validator("json", (value) => value as DeadlineEditInput),
		async (c) => {
			const result = await prepareEdit(c);
			if (result.error) return result.error;
			return c.json({
				...result.plan,
				previewVersion: { revision: result.revision, today: c.get("today") },
			});
		},
	)
	.patch(
		"/deadlines/:id",
		validator("json", (value) => value as DeadlineEditInput),
		async (c) => {
			const result = await prepareEdit(c);
			if (result.error) return result.error;
			const { db, userId, deadline, revision, data, plan } = result;
			const update = db
				.update(deadlines)
				.set(data)
				.where(
					and(eq(deadlines.id, deadline.id), eq(deadlines.userId, userId)),
				);
			await commitPlan(
				db,
				userId,
				revision,
				result.planningChanged
					? [
							update,
							db
								.delete(studySessions)
								.where(
									and(
										eq(studySessions.userId, userId),
										eq(studySessions.deadlineId, deadline.id),
										eq(studySessions.ticked, false),
									),
								),
							...plan.sessions.map((session) =>
								db.insert(studySessions).values({
									...session,
									id: crypto.randomUUID(),
									userId,
									deadlineId: deadline.id,
								}),
							),
						]
					: [update],
			);
			return c.json({ deadline: { ...deadline, ...data }, ...plan });
		},
	);
