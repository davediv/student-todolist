import { env } from "cloudflare:test";
import { and, asc, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { getDb } from "../../src/db";
import { deadlines, studySessions, user } from "../../src/db/schema";
import type { DeadlineInput } from "../../src/lib/deadlines";
import { defaultLimits } from "../../src/lib/limits";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

const project: DeadlineInput = {
	title: "Large project",
	type: "project",
	startDate: "2026-10-26",
	dueDate: "2026-11-16",
	estimateMinutes: 900,
	notes: "",
};
const essay: DeadlineInput = {
	...project,
	title: "Urgent essay",
	type: "assignment",
	dueDate: "2026-10-29",
	estimateMinutes: 240,
};
type Plans = {
	plans: {
		deadlineId: string;
		title: string;
		dueDate: string;
		sessions: { date: string; minutes: number }[];
		keptSessions: { id: string; date: string; minutes: number }[];
		shortfallMinutes: number;
	}[];
	pendingDeadlineId?: string;
};
function post(
	path: string,
	headers: Record<string, string>,
	value: unknown = {},
	bindings = env,
) {
	return apiApp.request(
		path,
		{
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(value),
		},
		bindings,
	);
}
async function setup(email = "student@example.com") {
	const headers = await signedInHeaders(email, "2026-10-26");
	await apiApp.request(
		"/api/limits",
		{
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(defaultLimits),
		},
		env,
	);
	const created = (await (
		await post("/api/deadlines", headers, project)
	).json()) as { deadline: { id: string; userId: string } };
	return { headers, ...created.deadline };
}
function rows(id: string) {
	return getDb(env)
		.select()
		.from(studySessions)
		.where(eq(studySessions.deadlineId, id))
		.orderBy(asc(studySessions.date));
}

it("previews without writes and atomically prioritizes a pending 4h essay ahead of a 15h project", async () => {
	const { headers, id } = await setup();
	const before = await rows(id);
	expect(before).toHaveLength(5);
	const firstPreview = await post("/api/deadlines/preview", headers, essay);
	expect(await firstPreview.json()).toMatchObject({ shortfallMinutes: 240 });
	const input = { pending: { input: essay } };
	const response = await post("/api/replan/all/preview", headers, input);
	expect(response.status).toBe(200);
	const preview = (await response.json()) as Plans;
	expect(preview.plans.map((plan) => plan.title)).toEqual([
		"Urgent essay",
		"Large project",
	]);
	expect(preview.plans[0]).toMatchObject({
		sessions: [
			{ date: "2026-10-26", minutes: 180 },
			{ date: "2026-10-27", minutes: 60 },
		],
		shortfallMinutes: 0,
	});
	expect(preview.plans[1].sessions[0]).toEqual({
		date: "2026-10-27",
		minutes: 120,
	});
	expect(await rows(id)).toEqual(before);
	expect(await getDb(env).select().from(deadlines)).toHaveLength(1);
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
	const saved = await post("/api/replan/all", headers, input, {
		...env,
		DB: database,
	});
	expect(saved.status).toBe(200);
	const result = (await saved.json()) as Plans;
	expect(result.plans).toEqual(preview.plans);
	expect(batches).toBe(1);
	expect(await getDb(env).select().from(deadlines)).toHaveLength(2);
	for (const plan of preview.plans) {
		const deadlineId =
			plan.deadlineId === "pending-new"
				? (result.pendingDeadlineId as string)
				: plan.deadlineId;
		expect(
			(await rows(deadlineId)).map(({ date, minutes }) => ({ date, minutes })),
		).toEqual(plan.sessions);
	}
});

it("keeps ticked sessions, Done deadlines, past-due deadlines and other students untouched", async () => {
	const { headers, id, userId } = await setup();
	const foreign = await setup("friend@example.com");
	const foreignBefore = await rows(foreign.id);
	const [ticked] = await rows(id);
	await getDb(env)
		.update(studySessions)
		.set({ ticked: true, tickedAt: new Date("2026-10-26T08:00:00Z") })
		.where(eq(studySessions.id, ticked.id));
	for (const [specialId, dueDate, status] of [
		["past", "2026-10-25", "active"],
		["done", "2026-11-16", "done"],
	] as const) {
		await getDb(env)
			.insert(deadlines)
			.values({
				...project,
				id: specialId,
				userId,
				dueDate,
				status,
				startDate: "2026-10-20",
			});
		await getDb(env)
			.insert(studySessions)
			.values({
				id: `${specialId}-session`,
				deadlineId: specialId,
				userId,
				date: "2026-10-24",
				minutes: 90,
			});
	}
	const pastBefore = await rows("past");
	const doneBefore = await rows("done");
	const kept = (await rows(id))[0];
	const preview = (await (
		await post("/api/replan/all/preview", headers)
	).json()) as Plans;
	expect(preview.plans).toHaveLength(1);
	expect(preview.plans[0].keptSessions).toEqual([
		{ id: kept.id, date: kept.date, minutes: kept.minutes },
	]);
	expect((await post("/api/replan/all", headers)).status).toBe(200);
	expect((await rows(id))[0]).toEqual(kept);
	expect(await rows("past")).toEqual(pastBefore);
	expect(await rows("done")).toEqual(doneBefore);
	expect(await rows(foreign.id)).toEqual(foreignBefore);
});

it("applies a pending edit together with all plans while retaining completed work", async () => {
	const { headers, id } = await setup();
	const [first] = await rows(id);
	await getDb(env)
		.update(studySessions)
		.set({ ticked: true, tickedAt: new Date() })
		.where(eq(studySessions.id, first.id));
	const before = await rows(id);
	const input = {
		pending: { id, input: { ...essay, title: "Edited project" } },
	};
	const preview = (await (
		await post("/api/replan/all/preview", headers, input)
	).json()) as Plans;
	expect(preview.plans[0]).toMatchObject({
		title: "Edited project",
		sessions: [{ date: "2026-10-27", minutes: 60 }],
		shortfallMinutes: 0,
	});
	expect(await rows(id)).toEqual(before);
	const saved = await post("/api/replan/all", headers, input);
	expect(saved.status).toBe(200);
	expect(await saved.json()).toMatchObject(preview);
	expect((await rows(id))[0]).toEqual(before[0]);
	expect(
		await getDb(env).query.deadlines.findFirst({ where: eq(deadlines.id, id) }),
	).toMatchObject({ title: "Edited project", estimateMinutes: 240 });
	expect(await getDb(env).select().from(deadlines)).toHaveLength(1);
});

it.each([
	false,
	true,
])("rolls back the pending %s and every replacement when a later batch statement fails", async (edit) => {
	const { headers, id, userId } = await setup();
	const before = await rows(id);
	const itemsBefore = await getDb(env).select().from(deadlines);
	const revisionBefore = await getDb(env).query.user.findFirst({
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
		const response = await post(
			"/api/replan/all",
			headers,
			{ pending: { ...(edit ? { id } : {}), input: essay } },
			{ ...env, DB: database },
		);
		expect(response.status).toBe(500);
	} finally {
		log.mockRestore();
	}
	expect(await rows(id)).toEqual(before);
	expect(await getDb(env).select().from(deadlines)).toEqual(itemsBefore);
	expect(
		await getDb(env).query.user.findFirst({ where: eq(user.id, userId) }),
	).toEqual(revisionBefore);
});

it("rejects foreign, missing, Done and invalid pending deadlines without writes", async () => {
	const { headers, id } = await setup();
	const foreign = await signedInHeaders("friend@example.com", "2026-10-26");
	const before = await rows(id);
	for (const path of ["/api/replan/all/preview", "/api/replan/all"]) {
		expect(
			(await post(path, foreign, { pending: { id, input: essay } })).status,
		).toBe(404);
		expect(
			(await post(path, headers, { pending: { id: "missing", input: essay } }))
				.status,
		).toBe(404);
		expect(
			(
				await post(path, headers, {
					pending: { input: { ...essay, estimateMinutes: 31 } },
				})
			).status,
		).toBe(400);
	}
	await getDb(env)
		.update(deadlines)
		.set({ status: "done" })
		.where(eq(deadlines.id, id));
	for (const path of ["/api/replan/all/preview", "/api/replan/all"])
		expect(
			(await post(path, headers, { pending: { id, input: essay } })).status,
		).toBe(409);
	expect(await rows(id)).toEqual(before);
});

it("returns remaining shortfalls when all work cannot fit", async () => {
	const { headers } = await setup();
	const result = (await (
		await post("/api/replan/all/preview", headers, {
			pending: { input: { ...essay, estimateMinutes: 600 } },
		})
	).json()) as Plans;
	expect(result.plans[0].shortfallMinutes).toBe(60);
});

it("rejects a stale save if another plan write changes the revision", async () => {
	const { headers, id, userId } = await setup();
	const before = await rows(id);
	const database = new Proxy(env.DB, {
		get(target, key) {
			if (key === "batch")
				return async (statements: D1PreparedStatement[]) => {
					await getDb(env)
						.update(user)
						.set({ planRevision: sql`${user.planRevision}+1` })
						.where(eq(user.id, userId));
					return target.batch(statements);
				};
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const response = await post(
		"/api/replan/all",
		headers,
		{ pending: { input: essay } },
		{ ...env, DB: database },
	);
	expect(response.status).toBe(409);
	expect(await rows(id)).toEqual(before);
	expect(
		await getDb(env)
			.select()
			.from(deadlines)
			.where(and(eq(deadlines.userId, userId))),
	).toHaveLength(1);
});
