import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { deadlines, user } from "../../src/db/schema";
import {
	bumpRevision,
	commitPlan,
	PlanConflict,
	readRevision,
} from "../../src/server/planning-state";
import { signedInHeaders } from "./helpers";

it("rejects stale planning writes and leaves the batch untouched", async () => {
	await signedInHeaders();
	const db = getDb(env);
	const [student] = await db
		.select()
		.from(user)
		.where(eq(user.email, "student@example.com"));
	const revision = await readRevision(db, student.id);
	await bumpRevision(db, student.id);
	await expect(
		commitPlan(db, student.id, revision, [
			db.insert(deadlines).values({
				id: "stale",
				userId: student.id,
				title: "Stale",
				type: "other",
				startDate: "2026-10-23",
				dueDate: "2026-10-30",
				estimateMinutes: 30,
			}),
		]),
	).rejects.toBeInstanceOf(PlanConflict);
	expect(await db.select().from(deadlines)).toEqual([]);
	expect(await readRevision(db, student.id)).toBe(revision + 1);
});
