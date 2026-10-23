import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { getDb } from "../../src/db";
import {
	account,
	activityDays,
	daysOff,
	deadlines,
	series,
	studyLimits,
	studySessions,
	todos,
	verification,
} from "../../src/db/schema";
import { defaultLimits } from "../../src/lib/limits";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

async function fixture(email: string) {
	const headers = await signedInHeaders(email);
	const me = await apiApp.request("/api/me", { headers }, env);
	const { id } = (await me.json()) as { id: string };
	const db = getDb(env);
	const seriesId = crypto.randomUUID(),
		deadlineId = crypto.randomUUID();
	await db.insert(account).values({
		id: crypto.randomUUID(),
		userId: id,
		accountId: id,
		providerId: "google",
		accessToken: "test-token",
	});
	await db.insert(studyLimits).values({ userId: id, ...defaultLimits });
	await db.insert(daysOff).values({
		id: crypto.randomUUID(),
		userId: id,
		date: "2026-10-23",
		limitMinutes: 0,
	});
	await db.insert(series).values({
		id: seriesId,
		userId: id,
		title: "Weekly work",
		type: "assignment",
		estimateMinutes: 60,
		weekdays: [5],
		leadDays: 7,
		endDate: "2026-11-30",
	});
	await db.insert(deadlines).values({
		id: deadlineId,
		userId: id,
		seriesId,
		title: "Essay",
		type: "assignment",
		dueDate: "2026-10-30",
		startDate: "2026-10-22",
		estimateMinutes: 60,
	});
	await db.insert(studySessions).values({
		id: crypto.randomUUID(),
		userId: id,
		deadlineId,
		date: "2026-10-22",
		minutes: 60,
	});
	await db
		.insert(todos)
		.values({ id: crypto.randomUUID(), userId: id, title: "Read notes" });
	await db.insert(activityDays).values({ userId: id, date: "2026-10-21" });
	await db.insert(verification).values({
		id: crypto.randomUUID(),
		identifier: email,
		value: "test-verification",
		expiresAt: new Date(Date.now() + 60000),
	});
	return { id, email, headers };
}

async function snapshot(student: { id: string; email: string }) {
	const rows: Record<string, unknown[]> = {};
	for (const table of [
		"user",
		"session",
		"account",
		"activity_days",
		"study_limits",
		"days_off",
		"series",
		"deadlines",
		"study_sessions",
		"todos",
		"verification",
	]) {
		const column =
			table === "user"
				? "id"
				: table === "verification"
					? "identifier"
					: "user_id";
		rows[table] = (
			await env.DB.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`)
				.bind(table === "verification" ? student.email : student.id)
				.all()
		).results;
	}
	return rows;
}

it("deletes every owned row and clears cookies while preserving a second student", async () => {
	const own = await fixture("student@example.com");
	const friend = await fixture("friend@example.com");
	// Another active browser session must also be revoked by the cascade.
	const anotherSession = await signedInHeaders(own.email);
	const before = await snapshot(friend);
	for (const rows of Object.values(await snapshot(own)))
		expect(rows.length).toBeGreaterThan(0);
	const response = await apiApp.request(
		"/api/account",
		{ method: "DELETE", headers: own.headers },
		env,
	);
	expect(response.status).toBe(204);
	expect(await response.text()).toBe("");
	expect(response.headers.getSetCookie()).toEqual(
		expect.arrayContaining([
			expect.stringMatching(/session_token=;.*Max-Age=0/i),
		]),
	);
	for (const rows of Object.values(await snapshot(own)))
		expect(rows).toEqual([]);
	expect(await snapshot(friend)).toEqual(before);
	for (const headers of [own.headers, anotherSession])
		expect((await apiApp.request("/api/me", { headers }, env)).status).toBe(
			401,
		);
	const fresh = await signedInHeaders(own.email);
	const me = await apiApp.request("/api/me", { headers: fresh }, env);
	const freshUser = (await me.json()) as { id: string };
	expect(freshUser.id).not.toBe(own.id);
	expect(
		await (await apiApp.request("/api/limits", { headers: fresh }, env)).json(),
	).toBeNull();
	expect(
		await (
			await apiApp.request("/api/deadlines", { headers: fresh }, env)
		).json(),
	).toEqual({ pastDue: [], active: [], done: [] });
});

it("requires a live session and does not accept a target user id", async () => {
	const own = await fixture("student@example.com");
	const before = await snapshot(own);
	expect(
		(
			await apiApp.request(
				`/api/account?userId=${own.id}`,
				{ method: "DELETE", headers: { "X-Local-Date": "2026-10-22" } },
				env,
			)
		).status,
	).toBe(401);
	expect(await snapshot(own)).toEqual(before);
});

it("removes owned OAuth linking state while preserving foreign, malformed and unrelated verification values", async () => {
	const own = await fixture("student@example.com");
	const friend = await fixture("friend@example.com");
	const db = getDb(env);
	for (const student of [own, friend]) {
		const response = await apiApp.request(
			"/api/auth/link-social",
			{
				method: "POST",
				headers: {
					...student.headers,
					origin: env.BETTER_AUTH_URL,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					provider: "google",
					callbackURL: env.BETTER_AUTH_URL,
					disableRedirect: true,
				}),
			},
			env,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ redirect: false });
	}
	const state = await db.select().from(verification);
	const ownState = state.find((row) =>
		row.value.includes(`"userId":"${own.id}"`),
	);
	const friendState = state.find((row) =>
		row.value.includes(`"userId":"${friend.id}"`),
	);
	for (const row of [ownState, friendState]) {
		expect(row?.identifier).toMatch(/^auth-state:/);
		expect([own.id, own.email, friend.id, friend.email]).not.toContain(
			row?.identifier,
		);
	}
	const protectedValues = [
		{
			id: crypto.randomUUID(),
			identifier: `auth-state:${crypto.randomUUID()}`,
			value: `{"link":{"userId":"${own.id}"`,
		},
		{
			id: crypto.randomUUID(),
			identifier: `auth-state:${crypto.randomUUID()}`,
			value: JSON.stringify({ other: { userId: friend.id } }),
		},
		{
			id: crypto.randomUUID(),
			identifier: `unrelated:${crypto.randomUUID()}`,
			value: JSON.stringify({ link: { userId: own.id } }),
		},
	];
	await db.insert(verification).values(
		protectedValues.map((row) => ({
			...row,
			expiresAt: new Date(Date.now() + 60000),
		})),
	);
	const before = await db.select().from(verification);
	const response = await apiApp.request(
		"/api/account",
		{ method: "DELETE", headers: own.headers },
		env,
	);
	expect(response.status).toBe(204);
	const after = await db.select().from(verification);
	expect(after).not.toContainEqual(ownState);
	expect(after).toContainEqual(friendState);
	for (const row of protectedValues)
		expect(after).toContainEqual(before.find((saved) => saved.id === row.id));
	expect(after).toHaveLength(before.length - 2);
});

it("rolls back deletion atomically and retains the session if a database write fails", async () => {
	const own = await fixture("student@example.com");
	const before = await snapshot(own);
	await env.DB.exec(
		"CREATE TRIGGER reject_account_delete BEFORE DELETE ON user BEGIN SELECT RAISE(ABORT, 'test failure'); END",
	);
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const response = await apiApp.request(
			"/api/account",
			{ method: "DELETE", headers: own.headers },
			env,
		);
		expect(response.status).toBe(500);
		expect(await snapshot(own)).toEqual(before);
		expect(response.headers.get("set-cookie") ?? "").not.toContain("Max-Age=0");
		expect(
			(await apiApp.request("/api/me", { headers: own.headers }, env)).status,
		).toBe(200);
	} finally {
		log.mockRestore();
	}
});
