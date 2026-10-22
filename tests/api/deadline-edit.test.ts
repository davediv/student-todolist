import { env } from "cloudflare:test";
import { asc, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { deadlines, studySessions, user } from "../../src/db/schema";
import { defaultLimits } from "../../src/lib/limits";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

const input = {
	title: "Essay",
	type: "assignment",
	dueDate: "2026-10-30",
	startDate: "2026-10-23",
	estimateMinutes: 360,
	notes: "Read the prompt",
};
function request(
	path: string,
	headers: Record<string, string>,
	value: unknown,
	method = "PATCH",
	bindings = env,
) {
	return apiApp.request(
		path,
		{
			method,
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(value),
		},
		bindings,
	);
}
async function setup() {
	const headers = await signedInHeaders("student@example.com", "2026-10-26");
	await request("/api/limits", headers, defaultLimits, "PUT");
	const response = await request("/api/deadlines", headers, input, "POST");
	const created = (await response.json()) as {
		deadline: { id: string; userId: string };
	};
	const [first] = await rows(created.deadline.id);
	await getDb(env)
		.update(studySessions)
		.set({
			minutes: 120,
			ticked: true,
			tickedAt: new Date("2026-10-26T08:00:00Z"),
		})
		.where(eq(studySessions.id, first.id));
	return { headers, id: created.deadline.id, userId: created.deadline.userId };
}
function rows(id: string) {
	return getDb(env)
		.select()
		.from(studySessions)
		.where(eq(studySessions.deadlineId, id))
		.orderBy(asc(studySessions.date));
}
it("saves partial metadata edits without changing any sessions or resetting omitted fields", async () => {
	const { headers, id, userId } = await setup();
	const before = await rows(id);
	const response = await request(`/api/deadlines/${id}`, headers, {
		title: "  Renamed essay  ",
		type: "project",
		userId: "forged",
		status: "done",
	});
	expect(response.status).toBe(200);
	expect(await rows(id)).toEqual(before);
	expect(
		await getDb(env).query.deadlines.findFirst({ where: eq(deadlines.id, id) }),
	).toMatchObject({
		...input,
		title: "Renamed essay",
		type: "project",
		userId,
		status: "active",
	});
});
it("allows metadata edits on a past-due deadline, including an unchanged full form payload", async () => {
	const { headers, id } = await setup();
	const before = await rows(id);
	const response = await request(
		`/api/deadlines/${id}`,
		{ ...headers, "X-Local-Date": "2026-11-01" },
		{ ...input, title: "Past essay" },
	);
	expect(response.status).toBe(200);
	expect(await rows(id)).toEqual(before);
});
it("previews remaining hours without writes and saves the same replacement while preserving ticked IDs and timestamps", async () => {
	const { headers, id } = await setup();
	const before = await rows(id);
	const preview = await request(
		`/api/deadlines/${id}/preview`,
		headers,
		{ estimateMinutes: 480 },
		"POST",
	);
	expect(preview.status).toBe(200);
	const { previewVersion, ...plan } = (await preview.json()) as {
		sessions: { date: string; minutes: number }[];
		keptSessions: unknown[];
		shortfallMinutes: number;
		previewVersion: { revision: number; today: string };
	};
	expect(previewVersion).toEqual({
		revision: expect.any(Number),
		today: "2026-10-26",
	});
	expect(plan.sessions).toEqual([
		{ date: "2026-10-27", minutes: 180 },
		{ date: "2026-10-28", minutes: 180 },
	]);
	expect(plan.keptSessions).toEqual(JSON.parse(JSON.stringify([before[0]])));
	expect(plan.shortfallMinutes).toBe(0);
	expect(await rows(id)).toEqual(before);
	expect(
		(
			await getDb(env).query.deadlines.findFirst({
				where: eq(deadlines.id, id),
			})
		)?.estimateMinutes,
	).toBe(360);
	const saved = await request(`/api/deadlines/${id}`, headers, {
		estimateMinutes: 480,
		previewVersion,
	});
	expect(saved.status).toBe(200);
	expect(await saved.json()).toMatchObject(plan);
	const after = await rows(id);
	expect(after[0]).toEqual(before[0]);
	expect(
		after.slice(1).map(({ date, minutes }) => ({ date, minutes })),
	).toEqual(plan.sessions);
	expect(after.some((row) => row.id === before[1].id)).toBe(false);
});
it("rejects a stale preview after another mutation and accepts a refreshed preview", async () => {
	const { headers, id } = await setup();
	const preview = await request(
		`/api/deadlines/${id}/preview`,
		headers,
		{ estimateMinutes: 480 },
		"POST",
	);
	const { previewVersion } = (await preview.json()) as {
		previewVersion: { revision: number; today: string };
	};
	const mutated = await request(`/api/deadlines/${id}`, headers, {
		title: "Renamed elsewhere",
	});
	expect(mutated.status).toBe(200);
	const before = await rows(id);
	const stale = await request(`/api/deadlines/${id}`, headers, {
		title: "Stale edit",
		estimateMinutes: 480,
		previewVersion,
	});
	expect(stale.status).toBe(409);
	expect(await stale.json()).toMatchObject({ error: { code: "plan_changed" } });
	expect(await rows(id)).toEqual(before);
	expect(
		await getDb(env).query.deadlines.findFirst({ where: eq(deadlines.id, id) }),
	).toMatchObject({ title: "Renamed elsewhere", estimateMinutes: 360 });
	const refreshed = await request(
		`/api/deadlines/${id}/preview`,
		headers,
		{ estimateMinutes: 480 },
		"POST",
	);
	const refreshedPlan = (await refreshed.json()) as {
		previewVersion: typeof previewVersion;
		sessions: { date: string; minutes: number }[];
	};
	expect(refreshedPlan.previewVersion.revision).toBeGreaterThan(
		previewVersion.revision,
	);
	const saved = await request(`/api/deadlines/${id}`, headers, {
		estimateMinutes: 480,
		previewVersion: refreshedPlan.previewVersion,
	});
	expect(saved.status).toBe(200);
	expect(await saved.json()).toMatchObject({
		sessions: refreshedPlan.sessions,
	});
});
it("rejects an unchanged revision when the student's local day changed since preview", async () => {
	const { headers, id } = await setup();
	const preview = await request(
		`/api/deadlines/${id}/preview`,
		headers,
		{ estimateMinutes: 480 },
		"POST",
	);
	const { previewVersion } = (await preview.json()) as {
		previewVersion: { revision: number; today: string };
	};
	const before = await rows(id);
	const stale = await request(
		`/api/deadlines/${id}`,
		{ ...headers, "X-Local-Date": "2026-10-27" },
		{ estimateMinutes: 480, previewVersion },
	);
	expect(stale.status).toBe(409);
	expect(await stale.json()).toMatchObject({ error: { code: "plan_changed" } });
	expect(await rows(id)).toEqual(before);
	expect(
		(
			await getDb(env).query.deadlines.findFirst({
				where: eq(deadlines.id, id),
			})
		)?.estimateMinutes,
	).toBe(360);
});
it("respects other deadlines' capacity and reports shortfall after changing dates", async () => {
	const { headers, id } = await setup();
	const other = await request(
		"/api/deadlines",
		headers,
		{ ...input, title: "Other", estimateMinutes: 180 },
		"POST",
	);
	const otherId = ((await other.json()) as { deadline: { id: string } })
		.deadline.id;
	const otherBefore = await rows(otherId);
	const response = await request(
		`/api/deadlines/${id}/preview`,
		headers,
		{ startDate: "2026-10-28", dueDate: "2026-10-29", estimateMinutes: 480 },
		"POST",
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		sessions: [{ date: "2026-10-28", minutes: 60 }],
		shortfallMinutes: 300,
	});
	expect(await rows(otherId)).toEqual(otherBefore);
});
it("keeps completed work when the estimate is reduced below ticked minutes", async () => {
	const { headers, id } = await setup();
	const [ticked] = await rows(id);
	const response = await request(`/api/deadlines/${id}`, headers, {
		estimateMinutes: 60,
	});
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		sessions: [],
		shortfallMinutes: 0,
	});
	expect(await rows(id)).toEqual([ticked]);
});
it.each([
	["title", ""],
	["title", "a".repeat(121)],
	["type", "unknown"],
	["notes", null],
	["dueDate", "2026-10-26"],
	["dueDate", "2026-02-30"],
	["startDate", "2026-10-30"],
	["estimateMinutes", 0],
	["estimateMinutes", 6030],
	["estimateMinutes", 31],
])("rejects invalid %s in preview and patch without writes", async (field, value) => {
	const { headers, id } = await setup();
	const before = await rows(id);
	for (const preview of [true, false]) {
		const response = await request(
			`/api/deadlines/${id}${preview ? "/preview" : ""}`,
			headers,
			{ [field]: value },
			preview ? "POST" : "PATCH",
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "validation", fields: { [field]: expect.any(Array) } },
		});
	}
	expect(await rows(id)).toEqual(before);
});
it("returns 404 for foreign deadlines and 409 for Done deadlines in both routes", async () => {
	const { headers, id } = await setup();
	const foreign = await signedInHeaders("friend@example.com", "2026-10-26");
	for (const preview of [true, false]) {
		expect(
			(
				await request(
					`/api/deadlines/${id}${preview ? "/preview" : ""}`,
					foreign,
					{ title: "Forged" },
					preview ? "POST" : "PATCH",
				)
			).status,
		).toBe(404);
	}
	await getDb(env)
		.update(deadlines)
		.set({ status: "done" })
		.where(eq(deadlines.id, id));
	const before = await rows(id);
	for (const preview of [true, false]) {
		expect(
			(
				await request(
					`/api/deadlines/${id}${preview ? "/preview" : ""}`,
					headers,
					{ estimateMinutes: 480 },
					preview ? "POST" : "PATCH",
				)
			).status,
		).toBe(409);
	}
	expect(await rows(id)).toEqual(before);
});
it("rolls back all edits when another plan write changes the revision before saving", async () => {
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
	const response = await request(
		`/api/deadlines/${id}`,
		headers,
		{ title: "Changed", estimateMinutes: 480 },
		"PATCH",
		{ ...env, DB: database },
	);
	expect(response.status).toBe(409);
	expect(await rows(id)).toEqual(before);
	expect(
		(
			await getDb(env).query.deadlines.findFirst({
				where: eq(deadlines.id, id),
			})
		)?.title,
	).toBe(input.title);
});
