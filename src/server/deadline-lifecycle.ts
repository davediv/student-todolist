import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "#/db";
import { deadlines, studySessions } from "#/db/schema";
import { commitPlan, readRevision } from "./planning-state";
import type { ApiEnv } from "./types";

export const deadlineLifecycleRoutes = new Hono<ApiEnv>()
	.post("/deadlines/:id/done", async (c) => {
		const db = getDb(c.env);
		const userId = c.get("user").id;
		const revision = await readRevision(db, userId);
		const owner = and(
			eq(deadlines.id, c.req.param("id")),
			eq(deadlines.userId, userId),
		);
		const deadline = await db.query.deadlines.findFirst({ where: owner });
		if (!deadline)
			return c.json(
				{ error: { code: "not_found", message: "Deadline not found" } },
				404,
			);
		const update = {
			status: "done" as const,
			doneAt: deadline.doneAt ?? new Date(),
		};
		await commitPlan(db, userId, revision, [
			db.update(deadlines).set(update).where(owner),
			db
				.delete(studySessions)
				.where(
					and(
						eq(studySessions.userId, userId),
						eq(studySessions.deadlineId, deadline.id),
						eq(studySessions.ticked, false),
					),
				),
		]);
		return c.json({ deadline: { ...deadline, ...update } });
	})
	.delete("/deadlines/:id", async (c) => {
		const db = getDb(c.env);
		const userId = c.get("user").id;
		const revision = await readRevision(db, userId);
		const owner = and(
			eq(deadlines.id, c.req.param("id")),
			eq(deadlines.userId, userId),
		);
		const deadline = await db.query.deadlines.findFirst({ where: owner });
		if (!deadline)
			return c.json(
				{ error: { code: "not_found", message: "Deadline not found" } },
				404,
			);
		await commitPlan(db, userId, revision, [db.delete(deadlines).where(owner)]);
		return c.json({ deleted: deadline.id });
	});
