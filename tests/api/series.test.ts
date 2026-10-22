import { env } from "cloudflare:test";
import { asc, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { getDb } from "../../src/db";
import {
	daysOff,
	deadlines,
	series,
	studySessions,
	user,
} from "../../src/db/schema";
import { defaultLimits } from "../../src/lib/limits";
import { addDays } from "../../src/lib/planner";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

const today = "2026-10-14";
const input = {
	title: "Problem set",
	type: "assignment",
	notes: "Work through every question",
	estimateMinutes: 180,
	weekdays: [5],
	leadDays: 7,
	endDate: "2026-10-30",
};
type Preview = {
	previewVersion: { revision: number; today: string };
	occurrences: {
		id?: string;
		dueDate: string;
		startDate: string;
		sessions: { date: string; minutes: number }[];
		shortfallMinutes: number;
	}[];
};
function post(
	path: string,
	headers: Record<string, string>,
	body: unknown,
	bindings = env,
) {
	return apiApp.request(
		`/api${path}`,
		{
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		bindings,
	);
}
async function setup(email = "student@example.com") {
	const headers = await signedInHeaders(email, today);
	expect(
		(
			await apiApp.request(
				"/api/limits",
				{
					method: "PUT",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify(defaultLimits),
				},
				env,
			)
		).status,
	).toBe(200);
	const me = (await (
		await apiApp.request("/api/me", { headers }, env)
	).json()) as { id: string };
	return { headers, userId: me.id, db: getDb(env) };
}
async function planRows() {
	const db = getDb(env);
	return {
		series: await db.select().from(series),
		deadlines: await db.select().from(deadlines),
		sessions: await db.select().from(studySessions),
	};
}
it("previews without writes, then saves every reviewed occurrence and session in one batch", async () => {
	const { headers, userId, db } = await setup();
	const beforeRevision = (
		await db.query.user.findFirst({ where: eq(user.id, userId) })
	)?.planRevision;
	const response = await post("/series/preview", headers, input);
	expect(response.status).toBe(200);
	const preview = (await response.json()) as Preview;
	expect(
		preview.occurrences.map(({ dueDate, startDate }) => ({
			dueDate,
			startDate,
		})),
	).toEqual([
		{ dueDate: "2026-10-16", startDate: "2026-10-09" },
		{ dueDate: "2026-10-23", startDate: "2026-10-16" },
		{ dueDate: "2026-10-30", startDate: "2026-10-23" },
	]);
	expect(preview.occurrences[0]).toMatchObject({
		sessions: [{ date: today, minutes: 180 }],
		shortfallMinutes: 0,
	});
	expect(await planRows()).toEqual({ series: [], deadlines: [], sessions: [] });
	expect(
		(await db.query.user.findFirst({ where: eq(user.id, userId) }))
			?.planRevision,
	).toBe(beforeRevision);
	let batches = 0;
	const database = new Proxy(env.DB, {
		get(target, key) {
			if (key === "batch")
				return (statements: D1PreparedStatement[]) => {
					batches++;
					return target.batch(statements);
				};
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const saved = await post(
		"/series",
		headers,
		{
			...input,
			previewVersion: preview.previewVersion,
			userId: "forged",
			sessions: [{ date: today, minutes: 9999 }],
		},
		{ ...env, DB: database },
	);
	expect(saved.status).toBe(201);
	const body = (await saved.json()) as Preview & {
		series: { id: string; userId: string };
	};
	expect(batches).toBe(1);
	expect(body.series.userId).toBe(userId);
	expect(body.occurrences.map(({ id: _id, ...row }) => row)).toEqual(
		preview.occurrences,
	);
	const rows = await planRows();
	expect(rows.series).toHaveLength(1);
	expect(rows.deadlines).toHaveLength(3);
	for (const occurrence of body.occurrences) {
		expect(
			rows.deadlines.find((row) => row.id === occurrence.id),
		).toMatchObject({
			seriesId: body.series.id,
			userId,
			title: input.title,
			notes: input.notes,
			dueDate: occurrence.dueDate,
			startDate: occurrence.startDate,
			estimateMinutes: 180,
			status: "active",
		});
		expect(
			rows.sessions
				.filter((row) => row.deadlineId === occurrence.id)
				.map(({ date, minutes }) => ({ date, minutes })),
		).toEqual(occurrence.sessions);
	}
});
it.each([
	["weekdays", []],
	["endDate", undefined],
	["endDate", "2026-10-13"],
	["endDate", today],
	["endDate", addDays(today, 366)],
	["leadDays", 0],
	["leadDays", 61],
])("rejects invalid %s (%s) without writes", async (field, value) => {
	const { headers } = await setup();
	for (const path of ["/series/preview", "/series"]) {
		const response = await post(path, headers, {
			...input,
			[field as string]: value,
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: {
				code: "validation",
				fields: { [field as string]: expect.any(Array) },
			},
		});
	}
	expect(await planRows()).toEqual({ series: [], deadlines: [], sessions: [] });
});
it("rejects an end date with no selected weekday before it", async () => {
	const { headers } = await setup();
	expect(
		(
			await post("/series/preview", headers, {
				...input,
				endDate: "2026-10-15",
			})
		).status,
	).toBe(400);
	expect(
		(await post("/series", headers, { ...input, endDate: "2026-10-15" }))
			.status,
	).toBe(400);
	expect(await planRows()).toEqual({ series: [], deadlines: [], sessions: [] });
});
it("shares capacity across occurrences, reserves existing work and honours a dated override", async () => {
	const { headers, userId, db } = await setup();
	await db.insert(deadlines).values({
		id: "existing",
		userId,
		title: "Existing essay",
		type: "reading",
		startDate: today,
		dueDate: "2026-10-20",
		estimateMinutes: 60,
	});
	await db.insert(studySessions).values({
		id: "reserved",
		deadlineId: "existing",
		userId,
		date: today,
		minutes: 60,
		ticked: true,
		tickedAt: new Date(),
	});
	await db
		.insert(daysOff)
		.values({ id: "day-off", userId, date: "2026-10-15", limitMinutes: 60 });
	const existing = await db.select().from(studySessions);
	const body = { ...input, weekdays: [4, 5], endDate: "2026-10-16" };
	const preview = (await (
		await post("/series/preview", headers, body)
	).json()) as Preview;
	expect(preview.occurrences).toMatchObject([
		{
			dueDate: "2026-10-15",
			sessions: [{ date: today, minutes: 120 }],
			shortfallMinutes: 60,
		},
		{
			dueDate: "2026-10-16",
			sessions: [{ date: "2026-10-15", minutes: 60 }],
			shortfallMinutes: 120,
		},
	]);
	expect(
		(
			await post("/series", headers, {
				...body,
				previewVersion: preview.previewVersion,
			})
		).status,
	).toBe(201);
	expect(
		await db.query.studySessions.findFirst({
			where: eq(studySessions.id, "reserved"),
		}),
	).toEqual(existing[0]);
	const rows = await db.select().from(studySessions);
	expect(
		rows
			.filter((row) => row.date === today)
			.reduce((sum, row) => sum + row.minutes, 0),
	).toBe(180);
	expect(
		rows
			.filter((row) => row.date === "2026-10-15")
			.reduce((sum, row) => sum + row.minutes, 0),
	).toBe(60);
});
it("keeps foreign series and capacity separate and cascades all owned records when the account is deleted", async () => {
	const friend = await setup("friend@example.com");
	expect((await post("/series", friend.headers, input)).status).toBe(201);
	const foreign = await planRows();
	const { headers, userId, db } = await setup();
	const preview = (await (
		await post("/series/preview", headers, input)
	).json()) as Preview;
	expect(preview.occurrences[0]).toMatchObject({
		sessions: [{ date: today, minutes: 180 }],
		shortfallMinutes: 0,
	});
	expect(
		(
			await post("/series", headers, {
				...input,
				previewVersion: preview.previewVersion,
			})
		).status,
	).toBe(201);
	const combined = await planRows();
	for (const [table, before] of Object.entries(foreign))
		expect(
			combined[table as keyof typeof combined].filter(
				(row) => row.userId === friend.userId,
			),
		).toEqual(before);
	await db.delete(user).where(eq(user.id, userId));
	expect(await planRows()).toEqual(foreign);
});
it("rejects a CAS conflict before committing any part of a series", async () => {
	const { headers, userId, db } = await setup();
	const before = await planRows();
	const database = new Proxy(env.DB, {
		get(target, key) {
			if (key === "batch")
				return async (statements: D1PreparedStatement[]) => {
					await db
						.update(user)
						.set({ planRevision: sql`${user.planRevision}+1` })
						.where(eq(user.id, userId));
					return target.batch(statements);
				};
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const response = await post("/series", headers, input, {
		...env,
		DB: database,
	});
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({
		error: { code: "plan_changed" },
	});
	expect(await planRows()).toEqual(before);
});
it("rolls back the parent, every occurrence, sessions and revision if a later batch statement fails", async () => {
	const { headers, userId, db } = await setup();
	const before = await planRows();
	const revision = await db.query.user.findFirst({
		where: eq(user.id, userId),
	});
	const database = new Proxy(env.DB, {
		get(target, key) {
			if (key === "batch")
				return (statements: D1PreparedStatement[]) =>
					target.batch([
						...statements,
						target.prepare(
							"INSERT INTO study_sessions (id) VALUES ('invalid')",
						),
					]);
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		expect(
			(await post("/series", headers, input, { ...env, DB: database })).status,
		).toBe(500);
	} finally {
		log.mockRestore();
	}
	expect(await planRows()).toEqual(before);
	expect(await db.query.user.findFirst({ where: eq(user.id, userId) })).toEqual(
		revision,
	);
});
it.each([
	"revision",
	"local date",
])("rejects a reviewed preview made stale by %s", async (change) => {
	const { headers } = await setup();
	const preview = (await (
		await post("/series/preview", headers, input)
	).json()) as Preview;
	let saveHeaders = headers;
	if (change === "revision")
		await post("/days-off", headers, { date: today, limitMinutes: 0 });
	else saveHeaders = { ...headers, "X-Local-Date": "2026-10-15" };
	const before = await planRows();
	const response = await post("/series", saveHeaders, {
		...input,
		previewVersion: preview.previewVersion,
	});
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({
		error: { code: "plan_changed" },
	});
	expect(await planRows()).toEqual(before);
});
it("saves all 365 daily occurrences and sessions in a year without exceeding D1 binding limits", async () => {
	const { headers, db } = await setup();
	const body = {
		...input,
		estimateMinutes: 30,
		weekdays: [0, 1, 2, 3, 4, 5, 6],
		leadDays: 1,
		endDate: addDays(today, 365),
	};
	const preview = (await (
		await post("/series/preview", headers, body)
	).json()) as Preview;
	expect(preview.occurrences).toHaveLength(365);
	expect(
		preview.occurrences.every(
			(row) => row.shortfallMinutes === 0 && row.sessions.length === 1,
		),
	).toBe(true);
	const response = await post("/series", headers, {
		...body,
		previewVersion: preview.previewVersion,
	});
	expect(response.status).toBe(201);
	const saved = (await response.json()) as Preview;
	expect(saved.occurrences.map(({ id: _id, ...row }) => row)).toEqual(
		preview.occurrences,
	);
	expect(await db.select().from(series)).toHaveLength(1);
	expect(await db.select().from(deadlines)).toHaveLength(365);
	const sessions = await db
		.select()
		.from(studySessions)
		.orderBy(asc(studySessions.date));
	expect(sessions).toHaveLength(365);
	expect(sessions[0]).toMatchObject({ date: today, minutes: 30 });
	expect(sessions[364]).toMatchObject({
		date: addDays(today, 364),
		minutes: 30,
	});
});
