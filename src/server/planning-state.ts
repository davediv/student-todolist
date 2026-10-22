import { eq, sql } from "drizzle-orm";
import type { getDb } from "#/db";
import { deadlines, studyLimits, studySessions, user } from "#/db/schema";

type Db = ReturnType<typeof getDb>;
export class PlanConflict extends Error {
	constructor() {
		super("Your plan changed. Please try again.");
	}
}
export async function readRevision(db: Db, userId: string) {
	const row = await db.query.user.findFirst({
		where: eq(user.id, userId),
		columns: { planRevision: true },
	});
	if (!row) throw new PlanConflict();
	return row.planRevision;
}
export function bumpRevision(db: Db, userId: string) {
	return db
		.update(user)
		.set({ planRevision: sql`${user.planRevision}+1` })
		.where(eq(user.id, userId));
}
export async function commitPlan(
	db: Db,
	userId: string,
	revision: number,
	queries: Parameters<Db["batch"]>[0][number][],
) {
	try {
		return await db.batch([
			db
				.update(user)
				.set({
					planRevision: sql`case when ${user.planRevision}=${revision} then ${revision + 1} else null end`,
				})
				.where(eq(user.id, userId)),
			...queries,
		]);
	} catch (error) {
		const cause = error instanceof Error ? error.cause : null;
		if (
			cause instanceof Error &&
			cause.message.includes("NOT NULL constraint failed: user.plan_revision")
		)
			throw new PlanConflict();
		throw error;
	}
}
export function weekdayLimits(limits: typeof studyLimits.$inferSelect) {
	return {
		0: limits.sunday,
		1: limits.monday,
		2: limits.tuesday,
		3: limits.wednesday,
		4: limits.thursday,
		5: limits.friday,
		6: limits.saturday,
	};
}
export async function planningState(db: Db, userId: string) {
	const revision = await readRevision(db, userId);
	const limits = await db.query.studyLimits.findFirst({
		where: eq(studyLimits.userId, userId),
	});
	if (!limits) throw new PlanConflict();
	const sessions = await db
		.select()
		.from(studySessions)
		.where(eq(studySessions.userId, userId));
	const items = await db
		.select()
		.from(deadlines)
		.where(eq(deadlines.userId, userId));
	return { revision, limits, sessions, deadlines: items };
}
