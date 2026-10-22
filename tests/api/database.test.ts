import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/schema";

it("starts empty on a freshly migrated database", async () => {
	expect(await getDb(env).select().from(user)).toEqual([]);
});
it("enforces unique emails", async () => {
	const db = getDb(env);
	await db
		.insert(user)
		.values({ id: "one", name: "Student", email: "student@example.com" });
	await expect(
		db
			.insert(user)
			.values({ id: "two", name: "Student", email: "student@example.com" }),
	).rejects.toThrow();
});
it("cascades account and session deletion", async () => {
	const db = getDb(env);
	await db
		.insert(user)
		.values({ id: "one", name: "Student", email: "student@example.com" });
	await db.insert(session).values({
		id: "session",
		token: "token",
		userId: "one",
		expiresAt: new Date(Date.now() + 10000),
	});
	await db.insert(account).values({
		id: "account",
		accountId: "google-id",
		providerId: "google",
		userId: "one",
	});
	await db.delete(user).where(eq(user.id, "one"));
	expect(await db.select().from(session)).toEqual([]);
	expect(await db.select().from(account)).toEqual([]);
});
