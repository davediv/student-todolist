import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { daysOff, deadlines, studySessions, user } from "../../src/db/schema";
import { defaultLimits } from "../../src/lib/limits";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

const today = "2026-10-26";
const input = {
	title: "Essay",
	type: "assignment",
	startDate: today,
	dueDate: "2026-10-30",
	estimateMinutes: 240,
};
async function setup() {
	const headers = await signedInHeaders("student@example.com", today);
	const request = (path: string, method = "GET", body?: unknown) =>
		apiApp.request(
			`/api${path}`,
			{
				method,
				headers: { ...headers, "Content-Type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			},
			env,
		);
	await request("/limits", "PUT", defaultLimits);
	const me = (await (await request("/me")).json()) as { id: string };
	return { request, db: getDb(env), userId: me.id };
}
it.each([
	{ date: "2026-10-25", limitMinutes: 0 },
	{ date: "2026-02-30", limitMinutes: 0 },
	{ date: today, limitMinutes: -30 },
	{ date: today, limitMinutes: 750 },
	{ date: today, limitMinutes: 45 },
	{ date: today, limitMinutes: 0.5 },
])("rejects invalid days off (%j)", async (body) => {
	const { request } = await setup();
	expect((await request("/days-off", "POST", body)).status).toBe(400);
});
it("lists upcoming overrides in order, rejects duplicates, isolates owners and cascades", async () => {
	const { request, db, userId } = await setup();
	const row = (await (
		await request("/days-off", "POST", {
			date: "2026-10-28",
			limitMinutes: 720,
		})
	).json()) as { id: string };
	await request("/days-off", "POST", { date: today, limitMinutes: 0 });
	await db
		.insert(daysOff)
		.values({ id: "past", userId, date: "2026-10-24", limitMinutes: 0 });
	expect(
		(await request("/days-off", "POST", { date: today, limitMinutes: 60 }))
			.status,
	).toBe(409);
	expect(await (await request("/days-off")).json()).toMatchObject([
		{ date: today, limitMinutes: 0 },
		{ date: "2026-10-28", limitMinutes: 720 },
	]);
	const friend = await signedInHeaders("friend@example.com", today);
	expect(
		await (
			await apiApp.request("/api/days-off", { headers: friend }, env)
		).json(),
	).toEqual([]);
	expect(
		(
			await apiApp.request(
				`/api/days-off/${row.id}`,
				{ method: "DELETE", headers: friend },
				env,
			)
		).status,
	).toBe(404);
	expect((await request("/days-off/missing", "DELETE")).status).toBe(404);
	await db.delete(user).where(eq(user.id, userId));
	expect(await db.select().from(daysOff)).toEqual([]);
});
it("preserves existing sessions, marks over-limit dates and restores weekday capacity after removal", async () => {
	const { request, db, userId } = await setup();
	await request("/deadlines", "POST", input);
	const before = await db.select().from(studySessions);
	const oldRevision =
		(await db.query.user.findFirst({ where: eq(user.id, userId) }))
			?.planRevision ?? 0;
	const response = await request("/days-off", "POST", {
		date: today,
		limitMinutes: 0,
	});
	expect(response.status).toBe(201);
	const row = (await response.json()) as { id: string };
	expect(await db.select().from(studySessions)).toEqual(before);
	expect(
		(await db.query.user.findFirst({ where: eq(user.id, userId) }))
			?.planRevision,
	).toBe(oldRevision + 1);
	expect(
		await (await request(`/days?from=${today}&to=${today}`)).json(),
	).toMatchObject({
		days: [
			{
				date: today,
				limitMinutes: 0,
				isDayOff: true,
				plannedMinutes: 180,
				overLimit: true,
			},
		],
	});
	expect((await request(`/days-off/${row.id}`, "DELETE")).status).toBe(200);
	expect(
		await (await request(`/days?from=${today}&to=${today}`)).json(),
	).toMatchObject({
		days: [{ limitMinutes: 180, isDayOff: false, overLimit: false }],
	});
	expect(await db.select().from(studySessions)).toEqual(before);
	expect(
		(await db.query.user.findFirst({ where: eq(user.id, userId) }))
			?.planRevision,
	).toBe(oldRevision + 2);
});
for (const path of ["create", "edit", "overdue", "all"] as const) {
	it.each([
		0, 60,
	])(`${path} planning respects a %ih day-off limit in minutes`, async (limitMinutes) => {
		const { request, db, userId } = await setup();
		await request("/days-off", "POST", { date: today, limitMinutes });
		const expected =
			limitMinutes === 0
				? [
						{ date: "2026-10-27", minutes: 180 },
						{ date: "2026-10-28", minutes: 60 },
					]
				: [
						{ date: today, minutes: 60 },
						{ date: "2026-10-27", minutes: 180 },
					];
		if (path === "create") {
			expect(
				await (await request("/deadlines/preview", "POST", input)).json(),
			).toMatchObject({ sessions: expected, shortfallMinutes: 0 });
			expect((await request("/deadlines", "POST", input)).status).toBe(201);
		} else {
			await db.insert(deadlines).values({
				...input,
				type: "assignment",
				id: "essay",
				userId,
				estimateMinutes: path === "edit" ? 180 : 240,
			});
			await db.insert(studySessions).values({
				id: "old",
				userId,
				deadlineId: "essay",
				date: path === "overdue" ? "2026-10-24" : today,
				minutes: path === "edit" ? 180 : 240,
			});
			if (path === "edit") {
				expect(
					await (
						await request("/deadlines/essay/preview", "POST", {
							estimateMinutes: 240,
						})
					).json(),
				).toMatchObject({ sessions: expected, shortfallMinutes: 0 });
				expect(
					(await request("/deadlines/essay", "PATCH", { estimateMinutes: 240 }))
						.status,
				).toBe(200);
			} else if (path === "all") {
				expect(
					await (await request("/replan/all/preview", "POST", {})).json(),
				).toMatchObject({
					plans: [{ sessions: expected, shortfallMinutes: 0 }],
				});
				expect((await request("/replan/all", "POST", {})).status).toBe(200);
			} else {
				expect(
					await (await request("/replan/overdue", "POST")).json(),
				).toMatchObject({ plans: [{ moved: expected, shortfallMinutes: 0 }] });
			}
		}
		const rows = await db.select().from(studySessions);
		expect(
			rows
				.map(({ date, minutes }) => ({ date, minutes }))
				.sort((a, b) => a.date.localeCompare(b.date)),
		).toEqual(expected);
	});
}
it("invalidates a reviewed re-plan when days off change", async () => {
	const { request } = await setup();
	await request("/deadlines", "POST", input);
	const preview = (await (
		await request("/replan/all/preview", "POST", {})
	).json()) as { previewVersion: unknown };
	await request("/days-off", "POST", { date: today, limitMinutes: 0 });
	expect(
		(
			await request("/replan/all", "POST", {
				previewVersion: preview.previewVersion,
			})
		).status,
	).toBe(409);
});
