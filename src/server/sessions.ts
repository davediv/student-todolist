import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { getDb } from "#/db";
import { deadlines, studySessions } from "#/db/schema";
import { commitPlan, readRevision } from "./planning-state";
import type { ApiEnv } from "./types";

export const sessionsRoutes = new Hono<ApiEnv>()
	.patch(
		"/sessions/:id",
		validator("json", (body, c) => {
			const parsed = z
				.object({
					ticked: z.boolean().optional(),
					date: z.iso.date().optional(),
					minutes: z.number().int().min(30).max(720).multipleOf(30).optional(),
				})
				.strict()
				.refine(
					(value) =>
						Object.keys(value).length > 0 &&
						!(
							value.ticked !== undefined &&
							(value.date !== undefined || value.minutes !== undefined)
						),
				)
				.safeParse(body);
			if (!parsed.success)
				return c.json(
					{
						error: {
							code: "validation",
							message:
								"Choose a tick state, or a valid day and half-hour duration",
						},
					},
					400,
				);
			return parsed.data;
		}),
		async (c) => {
			const input = c.req.valid("json");
			const db = getDb(c.env);
			const userId = c.get("user").id;
			const revision = await readRevision(db, userId);
			const owner = and(
				eq(studySessions.id, c.req.param("id")),
				eq(studySessions.userId, userId),
			);
			const session = await db.query.studySessions.findFirst({ where: owner });
			if (!session)
				return c.json(
					{ error: { code: "not_found", message: "Session not found" } },
					404,
				);
			if (input.ticked !== undefined) {
				const update = {
					ticked: input.ticked,
					tickedAt: input.ticked ? (session.tickedAt ?? new Date()) : null,
				};
				await commitPlan(db, userId, revision, [
					db.update(studySessions).set(update).where(owner),
				]);
				return c.json({ session: { ...session, ...update } });
			}
			if (session.ticked)
				return c.json(
					{
						error: {
							code: "session_ticked",
							message: "Untick the session before moving or resizing it",
						},
					},
					409,
				);
			const deadline = await db.query.deadlines.findFirst({
				where: and(
					eq(deadlines.id, session.deadlineId),
					eq(deadlines.userId, userId),
				),
			});
			if (!deadline)
				return c.json(
					{ error: { code: "not_found", message: "Session not found" } },
					404,
				);
			if (
				input.date !== undefined &&
				(input.date < c.get("today") || input.date >= deadline.dueDate)
			)
				return c.json(
					{
						error: {
							code: "validation",
							message:
								"Choose a day from today through the day before the due date",
						},
					},
					400,
				);
			const update = {
				date: input.date ?? session.date,
				minutes: input.minutes ?? session.minutes,
			};
			if (update.date !== session.date) {
				const target = await db.query.studySessions.findFirst({
					where: and(
						eq(studySessions.userId, userId),
						eq(studySessions.deadlineId, session.deadlineId),
						eq(studySessions.date, update.date),
					),
				});
				if (target) {
					if (target.ticked)
						return c.json(
							{
								error: {
									code: "session_ticked",
									message:
										"That day already has a ticked session for this deadline",
								},
							},
							409,
						);
					const minutes = target.minutes + update.minutes;
					await commitPlan(db, userId, revision, [
						db
							.update(studySessions)
							.set({ minutes })
							.where(
								and(
									eq(studySessions.id, target.id),
									eq(studySessions.userId, userId),
								),
							),
						db.delete(studySessions).where(owner),
					]);
					return c.json({ session: { ...target, minutes } });
				}
			}
			await commitPlan(db, userId, revision, [
				db.update(studySessions).set(update).where(owner),
			]);
			return c.json({ session: { ...session, ...update } });
		},
	)
	.delete("/sessions/:id", async (c) => {
		const db = getDb(c.env);
		const userId = c.get("user").id;
		const revision = await readRevision(db, userId);
		const owner = and(
			eq(studySessions.id, c.req.param("id")),
			eq(studySessions.userId, userId),
		);
		const session = await db.query.studySessions.findFirst({ where: owner });
		if (!session)
			return c.json(
				{ error: { code: "not_found", message: "Session not found" } },
				404,
			);
		await commitPlan(db, userId, revision, [
			db.delete(studySessions).where(owner),
		]);
		return c.json({ deleted: session.id });
	});
