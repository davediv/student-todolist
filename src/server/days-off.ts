import { and, asc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { getDb } from "#/db";
import { daysOff } from "#/db/schema";
import { type DayOffInput, dayOffSchema } from "#/lib/days-off";
import { commitPlan, readRevision } from "./planning-state";
import type { ApiEnv } from "./types";

export const daysOffRoutes = new Hono<ApiEnv>()
	.get("/days-off", async (c) => {
		const rows = await getDb(c.env)
			.select()
			.from(daysOff)
			.where(
				and(
					eq(daysOff.userId, c.get("user").id),
					gte(daysOff.date, c.get("today")),
				),
			)
			.orderBy(asc(daysOff.date));
		return c.json(rows);
	})
	.post(
		"/days-off",
		validator("json", (value) => value as DayOffInput),
		async (c) => {
			const parsed = dayOffSchema(c.get("today")).safeParse(
				c.req.valid("json"),
			);
			if (!parsed.success)
				return c.json(
					{
						error: {
							code: "validation",
							message: "Check your day off",
							fields: parsed.error.flatten().fieldErrors,
						},
					},
					400,
				);
			const db = getDb(c.env),
				userId = c.get("user").id;
			const revision = await readRevision(db, userId);
			const existing = await db.query.daysOff.findFirst({
				where: and(
					eq(daysOff.userId, userId),
					eq(daysOff.date, parsed.data.date),
				),
			});
			if (existing)
				return c.json(
					{
						error: {
							code: "duplicate",
							message: "This date already has a day off",
						},
					},
					409,
				);
			const row = { id: crypto.randomUUID(), userId, ...parsed.data };
			await commitPlan(db, userId, revision, [db.insert(daysOff).values(row)]);
			return c.json(row, 201);
		},
	)
	.delete("/days-off/:id", async (c) => {
		const db = getDb(c.env),
			userId = c.get("user").id;
		const revision = await readRevision(db, userId);
		const where = and(
			eq(daysOff.id, c.req.param("id")),
			eq(daysOff.userId, userId),
		);
		const row = await db.query.daysOff.findFirst({ where });
		if (!row)
			return c.json(
				{ error: { code: "not_found", message: "Day off not found" } },
				404,
			);
		await commitPlan(db, userId, revision, [db.delete(daysOff).where(where)]);
		return c.json({ deleted: row.id });
	});
