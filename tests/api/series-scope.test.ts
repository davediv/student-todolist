import { env } from "cloudflare:test";
import { asc, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { getDb } from "../../src/db";
import { deadlines, series, studySessions, user } from "../../src/db/schema";
import { defaultLimits } from "../../src/lib/limits";
import { addDays } from "../../src/lib/planner";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

const today = "2026-10-14";
const input = {
	title: "Problem set",
	type: "assignment",
	notes: "Template notes",
	estimateMinutes: 180,
	weekdays: [5],
	leadDays: 7,
	endDate: "2026-11-06",
};
type Occurrence = {
	id: string;
	title: string;
	type: string;
	notes: string;
	estimateMinutes: number;
	dueDate: string;
	startDate: string;
	sessions: { date: string; minutes: number }[];
	keptSessions: { id: string; date: string; minutes: number }[];
	shortfallMinutes: number;
	action: "create" | "update";
};
type Preview = {
	occurrences: Occurrence[];
	removed: { id: string; title: string; dueDate: string }[];
	previewVersion: { revision: number; today: string };
};
function request(
	path: string,
	headers: Record<string, string>,
	method = "GET",
	body?: unknown,
	bindings = env,
) {
	return apiApp.request(
		`/api${path}`,
		{
			method,
			headers: { ...headers, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		},
		bindings,
	);
}
async function setup(email = "student@example.com") {
	const headers = await signedInHeaders(email, today);
	expect((await request("/limits", headers, "PUT", defaultLimits)).status).toBe(
		200,
	);
	const response = await request("/series", headers, "POST", input);
	expect(response.status).toBe(201);
	const body = (await response.json()) as {
		series: { id: string; userId: string };
		occurrences: { id: string; dueDate: string }[];
	};
	return {
		headers,
		db: getDb(env),
		seriesId: body.series.id,
		userId: body.series.userId,
		ids: body.occurrences.map((row) => row.id),
	};
}
function path(seriesId: string, id: string) {
	return `/series/${seriesId}/occurrences/${id}`;
}
async function snapshot() {
	const db = getDb(env);
	return {
		templates: await db.select().from(series).orderBy(asc(series.id)),
		deadlines: await db.select().from(deadlines).orderBy(asc(deadlines.id)),
		sessions: await db
			.select()
			.from(studySessions)
			.orderBy(asc(studySessions.id)),
	};
}
async function tick(headers: Record<string, string>, id: string) {
	const row = await getDb(env).query.studySessions.findFirst({
		where: eq(studySessions.deadlineId, id),
	});
	if (!row) throw new Error("No session to tick");
	expect(
		(await request(`/sessions/${row.id}`, headers, "PATCH", { ticked: true }))
			.status,
	).toBe(200);
	return getDb(env).query.studySessions.findFirst({
		where: eq(studySessions.id, row.id),
	});
}
it("previews and saves estimate and lead changes for the anchor and later Active occurrences only", async () => {
	const { headers, db, seriesId, ids } = await setup();
	const kept = await tick(headers, ids[1]);
	await tick(headers, ids[2]);
	expect(
		(await request(`/deadlines/${ids[2]}/done`, headers, "POST")).status,
	).toBe(200);
	const before = await snapshot();
	const changes = { estimateMinutes: 240, leadDays: 10 };
	const response = await request(
		`${path(seriesId, ids[1])}/preview`,
		headers,
		"POST",
		changes,
	);
	expect(response.status).toBe(200);
	const preview = (await response.json()) as Preview;
	expect(preview.occurrences.map((row) => row.id)).toEqual([ids[1], ids[3]]);
	expect(preview.removed).toEqual([]);
	expect(preview.occurrences[0].keptSessions).toContainEqual(
		expect.objectContaining({ id: kept?.id, date: kept?.date, minutes: 180 }),
	);
	for (const row of preview.occurrences) {
		expect(row.action).toBe("update");
		expect(row.estimateMinutes).toBe(240);
		expect(row.startDate).toBe(addDays(row.dueDate, -10));
		expect(
			row.sessions.reduce((sum, session) => sum + session.minutes, 0) +
				row.keptSessions.reduce((sum, session) => sum + session.minutes, 0) +
				row.shortfallMinutes,
		).toBe(240);
	}
	expect(await snapshot()).toEqual(before);
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
	const saved = await request(
		path(seriesId, ids[1]),
		headers,
		"PATCH",
		{ ...changes, previewVersion: preview.previewVersion },
		{ ...env, DB: database },
	);
	expect(saved.status).toBe(200);
	expect(await saved.json()).toMatchObject({
		occurrences: preview.occurrences,
		removed: [],
	});
	expect(batches).toBe(1);
	const after = await snapshot();
	for (const id of [ids[0], ids[2]]) {
		expect(after.deadlines.find((row) => row.id === id)).toEqual(
			before.deadlines.find((row) => row.id === id),
		);
		expect(after.sessions.filter((row) => row.deadlineId === id)).toEqual(
			before.sessions.filter((row) => row.deadlineId === id),
		);
	}
	expect(
		await db.query.studySessions.findFirst({
			where: eq(studySessions.id, kept?.id ?? ""),
		}),
	).toEqual(kept);
	for (const plan of preview.occurrences) {
		expect(after.deadlines.find((row) => row.id === plan.id)).toMatchObject({
			estimateMinutes: 240,
			startDate: plan.startDate,
		});
		expect(
			after.sessions
				.filter((row) => row.deadlineId === plan.id && !row.ticked)
				.map(({ date, minutes }) => ({ date, minutes }))
				.sort((a, b) => a.date.localeCompare(b.date)),
		).toEqual(plan.sessions);
	}
});
it("preserves individual metadata and start-date exceptions when those fields are not changed", async () => {
	const { headers, seriesId, ids } = await setup();
	expect(
		(
			await request(`/deadlines/${ids[2]}`, headers, "PATCH", {
				title: "Custom exam",
				type: "exam",
				notes: "Individual notes",
				startDate: "2026-10-25",
			})
		).status,
	).toBe(200);
	const response = await request(
		`${path(seriesId, ids[1])}/preview`,
		headers,
		"POST",
		{ estimateMinutes: 240 },
	);
	const preview = (await response.json()) as Preview;
	expect(preview.occurrences.find((row) => row.id === ids[2])).toMatchObject({
		title: "Custom exam",
		type: "exam",
		notes: "Individual notes",
		startDate: "2026-10-25",
		estimateMinutes: 240,
	});
	expect(
		(
			await request(path(seriesId, ids[1]), headers, "PATCH", {
				estimateMinutes: 240,
				previewVersion: preview.previewVersion,
			})
		).status,
	).toBe(200);
	expect(
		await getDb(env).query.deadlines.findFirst({
			where: eq(deadlines.id, ids[2]),
		}),
	).toMatchObject({
		title: "Custom exam",
		type: "exam",
		notes: "Individual notes",
		startDate: "2026-10-25",
		estimateMinutes: 240,
	});
	expect(
		(
			await request(path(seriesId, ids[1]), headers, "PATCH", {
				title: "New shared title",
				type: "project",
				notes: "Shared notes",
			})
		).status,
	).toBe(200);
	const rows = (await snapshot()).deadlines;
	for (const id of ids.slice(1))
		expect(rows.find((row) => row.id === id)).toMatchObject({
			title: "New shared title",
			type: "project",
			notes: "Shared notes",
		});
	expect(rows.find((row) => row.id === ids[0])?.title).toBe(input.title);
});
it("previews and removes later Active occurrences past a shortened end date, including completed session history", async () => {
	const { headers, seriesId, ids } = await setup();
	const removedTick = await tick(headers, ids[2]);
	await tick(headers, ids[3]);
	await request(`/deadlines/${ids[3]}/done`, headers, "POST");
	const before = await snapshot();
	const changes = { endDate: "2026-10-23" };
	const preview = (await (
		await request(`${path(seriesId, ids[1])}/preview`, headers, "POST", changes)
	).json()) as Preview;
	expect(preview.removed).toEqual([
		{ id: ids[2], title: input.title, dueDate: "2026-10-30" },
	]);
	expect(preview.occurrences.map((row) => row.id)).toEqual([ids[1]]);
	expect(await snapshot()).toEqual(before);
	expect(
		(
			await request(path(seriesId, ids[1]), headers, "PATCH", {
				...changes,
				previewVersion: preview.previewVersion,
			})
		).status,
	).toBe(200);
	const after = await snapshot();
	expect(after.deadlines.find((row) => row.id === ids[2])).toBeUndefined();
	expect(
		after.sessions.find((row) => row.id === removedTick?.id),
	).toBeUndefined();
	expect(after.deadlines.find((row) => row.id === ids[3])).toEqual(
		before.deadlines.find((row) => row.id === ids[3]),
	);
	expect(after.templates.find((row) => row.id === seriesId)?.endDate).toBe(
		changes.endDate,
	);
});
it("extends the series with plans that respect days off without restoring an individually deleted gap", async () => {
	const { headers, seriesId, ids } = await setup();
	expect(
		(await request(`/deadlines/${ids[2]}`, headers, "DELETE")).status,
	).toBe(200);
	await request("/days-off", headers, "POST", {
		date: "2026-11-06",
		limitMinutes: 0,
	});
	await request("/days-off", headers, "POST", {
		date: "2026-11-07",
		limitMinutes: 60,
	});
	const before = await snapshot();
	const changes = { endDate: "2026-11-20" };
	const preview = (await (
		await request(`${path(seriesId, ids[1])}/preview`, headers, "POST", changes)
	).json()) as Preview;
	expect(preview.removed).toEqual([]);
	expect(preview.occurrences.map((row) => row.dueDate)).toEqual([
		"2026-10-23",
		"2026-11-06",
		"2026-11-13",
		"2026-11-20",
	]);
	const added = preview.occurrences.filter((row) => row.action === "create");
	expect(added).toHaveLength(2);
	expect(added[0]).toMatchObject({
		dueDate: "2026-11-13",
		startDate: "2026-11-06",
		sessions: [
			{ date: "2026-11-07", minutes: 60 },
			{ date: "2026-11-08", minutes: 120 },
		],
		shortfallMinutes: 0,
	});
	expect(await snapshot()).toEqual(before);
	const response = await request(path(seriesId, ids[1]), headers, "PATCH", {
		...changes,
		previewVersion: preview.previewVersion,
	});
	expect(response.status).toBe(200);
	const saved = (await response.json()) as Preview;
	expect(
		saved.occurrences
			.filter((row) => row.action === "create")
			.every((row) => !row.id.startsWith("new:")),
	).toBe(true);
	const after = await snapshot();
	expect(after.deadlines).toHaveLength(5);
	expect(after.deadlines.some((row) => row.dueDate === "2026-10-30")).toBe(
		false,
	);
	for (const row of saved.occurrences)
		expect(
			after.sessions
				.filter((session) => session.deadlineId === row.id && !session.ticked)
				.map(({ date, minutes }) => ({ date, minutes }))
				.sort((a, b) => a.date.localeCompare(b.date)),
		).toEqual(row.sessions);
});
it("the ordinary edit and delete endpoints change only this occurrence", async () => {
	const { headers, seriesId, ids } = await setup();
	const before = await snapshot();
	expect(
		(
			await request(`/deadlines/${ids[1]}`, headers, "PATCH", {
				title: "Only this one",
				estimateMinutes: 240,
			})
		).status,
	).toBe(200);
	const afterEdit = await snapshot();
	expect(afterEdit.templates).toEqual(before.templates);
	for (const id of [ids[0], ids[2], ids[3]]) {
		expect(afterEdit.deadlines.find((row) => row.id === id)).toEqual(
			before.deadlines.find((row) => row.id === id),
		);
		expect(afterEdit.sessions.filter((row) => row.deadlineId === id)).toEqual(
			before.sessions.filter((row) => row.deadlineId === id),
		);
	}
	expect(afterEdit.deadlines.find((row) => row.id === ids[1])).toMatchObject({
		title: "Only this one",
		estimateMinutes: 240,
		seriesId,
	});
	expect(
		(await request(`/deadlines/${ids[1]}`, headers, "DELETE")).status,
	).toBe(200);
	const afterDelete = await snapshot();
	expect(afterDelete.templates).toEqual(before.templates);
	expect(afterDelete.deadlines).toEqual(
		before.deadlines.filter((row) => row.id !== ids[1]),
	);
	expect(afterDelete.sessions).toEqual(
		before.sessions.filter((row) => row.deadlineId !== ids[1]),
	);
});
it("deletes this and following Active occurrences and their sessions in one batch, preserving earlier and Done work", async () => {
	const { headers, seriesId, ids } = await setup();
	await tick(headers, ids[1]);
	await tick(headers, ids[2]);
	await request(`/deadlines/${ids[2]}/done`, headers, "POST");
	const before = await snapshot();
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
	const response = await request(
		path(seriesId, ids[1]),
		headers,
		"DELETE",
		undefined,
		{ ...env, DB: database },
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ deleted: [ids[1], ids[3]] });
	expect(batches).toBe(1);
	const after = await snapshot();
	expect(after.deadlines).toEqual(
		before.deadlines.filter((row) => ![ids[1], ids[3]].includes(row.id)),
	);
	expect(after.sessions).toEqual(
		before.sessions.filter((row) => ![ids[1], ids[3]].includes(row.deadlineId)),
	);
	expect(after.templates[0].endDate).toBe("2026-10-22");
});
it("scopes series lookup, previews, updates and deletes to the current account and the anchor's series", async () => {
	const { headers, seriesId, ids } = await setup();
	const friend = await setup("friend@example.com");
	expect((await request(`/series/${seriesId}`, headers)).status).toBe(200);
	expect((await request(`/series/${seriesId}`, friend.headers)).status).toBe(
		404,
	);
	expect((await request("/series/missing", headers)).status).toBe(404);
	const before = await snapshot();
	for (const [target, owner] of [
		[path(seriesId, ids[1]), friend.headers],
		[path(seriesId, friend.ids[1]), headers],
		[path("missing", ids[1]), headers],
		[path(seriesId, "missing"), headers],
	] as const) {
		for (const method of ["POST", "PATCH", "DELETE"])
			expect(
				(
					await request(
						method === "POST" ? `${target}/preview` : target,
						owner,
						method,
						method === "DELETE" ? undefined : { estimateMinutes: 240 },
					)
				).status,
			).toBe(404);
	}
	expect(await snapshot()).toEqual(before);
});
it.each([
	{ weekdays: [1] },
	{ leadDays: 0 },
	{ leadDays: 61 },
	{ endDate: today },
	{ endDate: addDays(today, 366) },
	{ estimateMinutes: 31 },
])("rejects unsupported or invalid scoped changes (%j)", async (changes) => {
	const { headers, seriesId, ids } = await setup();
	const before = await snapshot();
	for (const method of ["POST", "PATCH"]) {
		const response = await request(
			`${path(seriesId, ids[1])}${method === "POST" ? "/preview" : ""}`,
			headers,
			method,
			changes,
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "validation" },
		});
	}
	expect(await snapshot()).toEqual(before);
});
it.each([
	"revision",
	"local date",
])("rejects a scoped save when its preview is stale by %s", async (change) => {
	const { headers, seriesId, ids } = await setup();
	const changes = { estimateMinutes: 240 };
	const preview = (await (
		await request(`${path(seriesId, ids[1])}/preview`, headers, "POST", changes)
	).json()) as Preview;
	let saveHeaders = headers;
	if (change === "revision")
		await request("/days-off", headers, "POST", {
			date: today,
			limitMinutes: 0,
		});
	else saveHeaders = { ...headers, "X-Local-Date": "2026-10-15" };
	const before = await snapshot();
	const response = await request(path(seriesId, ids[1]), saveHeaders, "PATCH", {
		...changes,
		previewVersion: preview.previewVersion,
	});
	expect(response.status).toBe(409);
	expect(await snapshot()).toEqual(before);
});
it.each([
	"PATCH",
	"DELETE",
])("rolls back the full scoped %s when a later batch statement fails", async (method) => {
	const { headers, db, userId, seriesId, ids } = await setup();
	const before = await snapshot();
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
			(
				await request(
					path(seriesId, ids[1]),
					headers,
					method,
					method === "PATCH"
						? { title: "Changed", estimateMinutes: 240, endDate: "2026-11-20" }
						: undefined,
					{ ...env, DB: database },
				)
			).status,
		).toBe(500);
	} finally {
		log.mockRestore();
	}
	expect(await snapshot()).toEqual(before);
	expect(await db.query.user.findFirst({ where: eq(user.id, userId) })).toEqual(
		revision,
	);
});
it.each([
	"PATCH",
	"DELETE",
])("rejects a CAS conflict without committing a partial scoped %s", async (method) => {
	const { headers, db, userId, seriesId, ids } = await setup();
	const before = await snapshot();
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
	const response = await request(
		path(seriesId, ids[1]),
		headers,
		method,
		method === "PATCH"
			? { estimateMinutes: 240, endDate: "2026-11-20" }
			: undefined,
		{ ...env, DB: database },
	);
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({
		error: { code: "plan_changed" },
	});
	expect(await snapshot()).toEqual(before);
});
