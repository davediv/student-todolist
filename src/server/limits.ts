import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "#/db";
import { studyLimits } from "#/db/schema";
import { limitsSchema } from "#/lib/limits";
import { bumpRevision } from "./planning-state";
import type { ApiEnv } from "./types";
export const limitsRoutes = new Hono<ApiEnv>()
	.get("/limits", async (c) => {
		const row = await getDb(c.env).query.studyLimits.findFirst({
			where: eq(studyLimits.userId, c.get("user").id),
		});
		return c.json(row ? limitsSchema.parse(row) : null);
	})
	.put("/limits", async (c) => {
		const parsed = limitsSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json(
				{
					error: {
						code: "validation",
						message: "Check your study limits",
						fields: parsed.error.flatten().fieldErrors,
					},
				},
				400,
			);
		const db = getDb(c.env);
		await db.batch([
			db
				.insert(studyLimits)
				.values({ userId: c.get("user").id, ...parsed.data })
				.onConflictDoUpdate({ target: studyLimits.userId, set: parsed.data }),
			bumpRevision(db, c.get("user").id),
		]);
		return c.json(parsed.data);
	});
