import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { deadlines, studySessions } from "../../src/db/schema";
import { defaultLimits } from "../../src/lib/limits";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

const input = {
	title: "Essay (CS101)",
	type: "assignment",
	dueDate: "2026-10-30",
	startDate: "2026-10-23",
	estimateMinutes: 360,
	notes: "Read the prompt",
};
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
	return headers;
}
function post(path: string, headers: Record<string, string>, value: unknown) {
	return apiApp.request(
		path,
		{
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(value),
		},
		env,
	);
}
it("previews without writes and atomically saves the recomputed identical plan", async () => {
	const headers = await setup();
	const preview = await post("/api/deadlines/preview", headers, input);
	expect(preview.status).toBe(200);
	const plan = (await preview.json()) as {
		sessions: { date: string; minutes: number }[];
		shortfallMinutes: number;
	};
	expect(plan).toEqual({
		sessions: [
			{ date: "2026-10-26", minutes: 180 },
			{ date: "2026-10-27", minutes: 180 },
		],
		shortfallMinutes: 0,
	});
	expect(await getDb(env).select().from(deadlines)).toEqual([]);
	expect(await getDb(env).select().from(studySessions)).toEqual([]);
	const save = await post("/api/deadlines", headers, {
		...input,
		userId: "forged-owner",
		sessions: [{ date: input.dueDate, minutes: 6000 }],
	});
	expect(save.status).toBe(201);
	const saved = (await save.json()) as {
		deadline: { id: string; userId: string };
		sessions: unknown[];
	};
	expect(saved.sessions).toEqual(plan.sessions);
	expect(saved.deadline.userId).not.toBe("forged-owner");
	const detail = (await (
		await apiApp.request(
			`/api/deadlines/${saved.deadline.id}`,
			{ headers },
			env,
		)
	).json()) as { deadline: unknown; sessions: unknown[] };
	expect(detail.sessions).toHaveLength(2);
	await expect(
		getDb(env).insert(studySessions).values({
			id: "duplicate",
			userId: saved.deadline.userId,
			deadlineId: saved.deadline.id,
			date: "2026-10-26",
			minutes: 30,
		}),
	).rejects.toThrow();
	await getDb(env).delete(deadlines).where(eq(deadlines.id, saved.deadline.id));
	expect(await getDb(env).select().from(studySessions)).toEqual([]);
});
it.each([
	["title", ""],
	["title", "a".repeat(121)],
	["type", "unknown"],
	["dueDate", "2026-10-26"],
	["dueDate", "2026-02-30"],
	["startDate", "2026-10-30"],
	["estimateMinutes", 0],
	["estimateMinutes", 6030],
	["estimateMinutes", 31],
])("rejects invalid %s (%s) with field errors", async (field, value) => {
	const headers = await setup();
	for (const path of ["/api/deadlines/preview", "/api/deadlines"]) {
		const response = await post(path, headers, { ...input, [field]: value });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: {
				code: "validation",
				fields: { [field as string]: expect.any(Array) },
			},
		});
	}
	expect(await getDb(env).select().from(deadlines)).toEqual([]);
});
it("requires limits and does not plan before today's local date", async () => {
	const headers = await signedInHeaders("student@example.com", "2026-10-26");
	expect((await post("/api/deadlines/preview", headers, input)).status).toBe(
		409,
	);
});
it("counts other deadlines and recomputes capacity on save", async () => {
	const headers = await setup();
	const preview = (await (
		await post("/api/deadlines/preview", headers, input)
	).json()) as { sessions: { date: string; minutes: number }[] };
	expect(preview.sessions[0].minutes).toBe(180);
	await post("/api/deadlines", headers, {
		...input,
		title: "Earlier work",
		estimateMinutes: 120,
	});
	const result = (await (
		await post("/api/deadlines", headers, input)
	).json()) as { sessions: { date: string; minutes: number }[] };
	expect(result.sessions).toEqual([
		{ date: "2026-10-26", minutes: 60 },
		{ date: "2026-10-27", minutes: 180 },
		{ date: "2026-10-28", minutes: 120 },
	]);
});
it("lists active deadlines by due date with accurate progress and isolates owners", async () => {
	const headers = await setup();
	const friend = await setup("friend@example.com");
	const late = (await (
		await post("/api/deadlines", headers, {
			...input,
			title: "Large project",
			dueDate: "2026-10-29",
			estimateMinutes: 2400,
		})
	).json()) as { deadline: { id: string } };
	const early = (await (
		await post("/api/deadlines", headers, {
			...input,
			title: "Earlier exam",
			dueDate: "2026-10-28",
			estimateMinutes: 60,
		})
	).json()) as { deadline: { id: string } };
	const [firstSession] = await getDb(env)
		.select()
		.from(studySessions)
		.where(eq(studySessions.deadlineId, late.deadline.id));
	await getDb(env)
		.update(studySessions)
		.set({ ticked: true })
		.where(eq(studySessions.id, firstSession.id));
	const list = (await (
		await apiApp.request("/api/deadlines", { headers }, env)
	).json()) as {
		id: string;
		title: string;
		tickedMinutes: number;
		plannedMinutes: number;
		unplannedMinutes: number;
	}[];
	expect(list.map((row) => row.title)).toEqual([
		"Earlier exam",
		"Large project",
	]);
	expect(list[1]).toMatchObject({
		tickedMinutes: 180,
		plannedMinutes: 540,
		unplannedMinutes: 1860,
	});
	expect(
		(
			await apiApp.request(
				`/api/deadlines/${late.deadline.id}`,
				{ headers: friend },
				env,
			)
		).status,
	).toBe(404);
	expect(
		await (
			await apiApp.request("/api/deadlines", { headers: friend }, env)
		).json(),
	).toEqual([]);
	await getDb(env)
		.update(deadlines)
		.set({ status: "done" })
		.where(eq(deadlines.id, early.deadline.id));
	expect(
		await (await apiApp.request("/api/deadlines", { headers }, env)).json(),
	).toHaveLength(1);
});
it("saves 200 sessions within D1 statement limits and uses the user/date index", async () => {
	const headers = await setup();
	const limits = Object.fromEntries(
		Object.keys(defaultLimits).map((day) => [day, 30]),
	);
	await apiApp.request(
		"/api/limits",
		{
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(limits),
		},
		env,
	);
	const response = await post("/api/deadlines", headers, {
		...input,
		dueDate: "2027-06-01",
		estimateMinutes: 6000,
	});
	expect(response.status).toBe(201);
	expect(await getDb(env).select().from(studySessions)).toHaveLength(200);
	const query = await env.DB.prepare(
		"EXPLAIN QUERY PLAN SELECT * FROM study_sessions WHERE user_id = ? AND date >= ? AND date < ?",
	)
		.bind("student", "2026-10-26", "2026-11-01")
		.all();
	expect(JSON.stringify(query.results)).toContain(
		"study_sessions_user_date_idx",
	);
});
