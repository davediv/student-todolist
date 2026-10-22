import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { getDb } from "#/db";
import { studySessions } from "#/db/schema";
import { commitPlan, readRevision } from "./planning-state";
import type { ApiEnv } from "./types";

export const sessionsRoutes = new Hono<ApiEnv>().patch(
	"/sessions/:id",
	validator("json", (body, c) => {
		const parsed = z.object({ ticked: z.boolean() }).strict().safeParse(body);
		if (!parsed.success)
			return c.json(
				{
					error: {
						code: "validation",
						message: "Choose whether the session is ticked",
					},
				},
				400,
			);
		return parsed.data;
	}),
	async (c) => {
		const { ticked } = c.req.valid("json");
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
		const update = {
			ticked,
			tickedAt: ticked ? (session.tickedAt ?? new Date()) : null,
		};
		await commitPlan(db, userId, revision, [
			db.update(studySessions).set(update).where(owner),
		]);
		return c.json({ session: { ...session, ...update } });
	},
);
