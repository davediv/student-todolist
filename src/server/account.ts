import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "#/db";
import { user, verification } from "#/db/schema";
import { getAuth } from "#/lib/auth";
import type { ApiEnv } from "./types";

export const accountRoutes = new Hono<ApiEnv>().delete(
	"/account",
	async (c) => {
		const student = c.get("user");
		const db = getDb(c.env);
		// Foreign keys remove all owned planner data, linked accounts and sessions.
		await db.batch([
			db
				.delete(verification)
				.where(inArray(verification.identifier, [student.id, student.email])),
			db.delete(user).where(eq(user.id, student.id)),
		]);
		const { headers } = await getAuth(c.env).api.signOut({
			headers: c.req.raw.headers,
			returnHeaders: true,
		});
		for (const cookie of headers.getSetCookie())
			c.header("Set-Cookie", cookie, { append: true });
		return c.body(null, 204);
	},
);
