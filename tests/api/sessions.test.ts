import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { studySessions, user } from "../../src/db/schema";
import { defaultLimits } from "../../src/lib/limits";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

async function setup() {
	const headers = await signedInHeaders("student@example.com", "2026-10-26");
	await apiApp.request(
		"/api/limits",
		{
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(defaultLimits),
		},
		env,
	);
	const response = await apiApp.request(
		"/api/deadlines",
		{
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Essay",
				type: "assignment",
				dueDate: "2026-10-30",
				startDate: "2026-10-26",
				estimateMinutes: 360,
			}),
		},
		env,
	);
	expect(response.status).toBe(201);
	const [session] = await getDb(env).select().from(studySessions);
	return { headers, session };
}
function patch(id: string, headers: Record<string, string>, value: unknown) {
	return apiApp.request(
		`/api/sessions/${id}`,
		{
			method: "PATCH",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(value),
		},
		env,
	);
}
it("ticks and unticks a session with timestamps and immediate deadline progress", async () => {
	const { headers, session } = await setup();
	expect((await patch(session.id, headers, { ticked: true })).status).toBe(200);
	const ticked = await getDb(env).query.studySessions.findFirst({
		where: eq(studySessions.id, session.id),
	});
	expect(ticked).toMatchObject({ ticked: true, tickedAt: expect.any(Date) });
	const response = await apiApp.request("/api/deadlines", { headers }, env);
	expect(await response.json()).toMatchObject({
		active: [{ tickedMinutes: 180, estimateMinutes: 360 }],
	});
	await patch(session.id, headers, { ticked: true });
	expect(
		(
			await getDb(env).query.studySessions.findFirst({
				where: eq(studySessions.id, session.id),
			})
		)?.tickedAt,
	).toEqual(ticked?.tickedAt);
	expect((await patch(session.id, headers, { ticked: false })).status).toBe(
		200,
	);
	expect(
		await getDb(env).query.studySessions.findFirst({
			where: eq(studySessions.id, session.id),
		}),
	).toMatchObject({ ticked: false, tickedAt: null });
	expect(
		await (await apiApp.request("/api/deadlines", { headers }, env)).json(),
	).toMatchObject({ active: [{ tickedMinutes: 0 }] });
});
it("returns 404 for missing sessions and another student's session", async () => {
	const { session } = await setup();
	const headers = await signedInHeaders("friend@example.com", "2026-10-26");
	for (const id of [session.id, "missing"])
		expect((await patch(id, headers, { ticked: true })).status).toBe(404);
	expect(
		(
			await getDb(env).query.studySessions.findFirst({
				where: eq(studySessions.id, session.id),
			})
		)?.ticked,
	).toBe(false);
});
it.each([
	{},
	{ ticked: "true" },
	{ ticked: null },
	{ ticked: true, minutes: 0 },
	{ minutes: 31 },
])("rejects invalid tick bodies (%j)", async (body) => {
	const { headers, session } = await setup();
	expect((await patch(session.id, headers, body)).status).toBe(400);
	expect(
		(
			await getDb(env).query.studySessions.findFirst({
				where: eq(studySessions.id, session.id),
			})
		)?.ticked,
	).toBe(false);
});

it("moves a session without respecting capacity and reports an over-limit receiving day", async () => {
	const { headers, session } = await setup();
	await apiApp.request(
		"/api/limits",
		{
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ ...defaultLimits, wednesday: 30 }),
		},
		env,
	);
	expect(
		(await patch(session.id, headers, { date: "2026-10-28" })).status,
	).toBe(200);
	expect(
		await getDb(env).query.studySessions.findFirst({
			where: eq(studySessions.id, session.id),
		}),
	).toMatchObject({ date: "2026-10-28", minutes: 180 });
	expect(
		await (
			await apiApp.request(
				"/api/days?from=2026-10-28&to=2026-10-28",
				{ headers },
				env,
			)
		).json(),
	).toMatchObject({ days: [{ plannedMinutes: 180, overLimit: true }] });
});
it("merges onto another unticked session atomically, retaining one unique deadline/day", async () => {
	const { headers, session } = await setup();
	const response = await patch(session.id, headers, { date: "2026-10-27" });
	expect(response.status).toBe(200);
	const sessions = await getDb(env).select().from(studySessions);
	expect(sessions).toHaveLength(1);
	expect(sessions[0]).toMatchObject({
		date: "2026-10-27",
		minutes: 360,
		ticked: false,
	});
	expect(sessions[0].id).not.toBe(session.id);
	expect(
		await getDb(env).query.studySessions.findFirst({
			where: eq(studySessions.id, session.id),
		}),
	).toBeUndefined();
});
it("rejects merging onto a ticked session without changing either session", async () => {
	const { headers, session } = await setup();
	const all = await getDb(env).select().from(studySessions);
	const target = all.find((row) => row.id !== session.id);
	if (!target) throw new Error("Missing fixture target");
	await patch(target.id, headers, { ticked: true });
	expect((await patch(session.id, headers, { date: target.date })).status).toBe(
		409,
	);
	expect(await getDb(env).select().from(studySessions)).toHaveLength(2);
	expect(
		await getDb(env).query.studySessions.findFirst({
			where: eq(studySessions.id, session.id),
		}),
	).toMatchObject({ date: session.date, minutes: 180 });
});
it.each([
	"2026-10-25",
	"2026-10-30",
	"2026-10-31",
	"2026-02-30",
])("rejects a move outside the planning window (%s)", async (date) => {
	const { headers, session } = await setup();
	expect((await patch(session.id, headers, { date })).status).toBe(400);
});
it.each([
	30, 90, 720,
])("accepts a half-hour duration of %s minutes", async (minutes) => {
	const { headers, session } = await setup();
	expect((await patch(session.id, headers, { minutes })).status).toBe(200);
	expect(
		await getDb(env).query.studySessions.findFirst({
			where: eq(studySessions.id, session.id),
		}),
	).toMatchObject({ minutes });
});
it.each([
	0,
	29,
	31,
	721,
	750,
	1.5,
	"60",
])("rejects an invalid duration (%s)", async (minutes) => {
	const { headers, session } = await setup();
	expect((await patch(session.id, headers, { minutes })).status).toBe(400);
});
it("forbids moving/resizing ticked sessions and mixing tick and edit in one request", async () => {
	const { headers, session } = await setup();
	await patch(session.id, headers, { ticked: true });
	for (const body of [{ date: "2026-10-28" }, { minutes: 90 }])
		expect((await patch(session.id, headers, body)).status).toBe(409);
	expect(
		(await patch(session.id, headers, { ticked: false, date: "2026-10-28" }))
			.status,
	).toBe(400);
});
it("isolates move, resize, and deletion from other students", async () => {
	const { session } = await setup();
	const headers = await signedInHeaders("friend@example.com", "2026-10-26");
	for (const body of [{ date: "2026-10-28" }, { minutes: 90 }])
		expect((await patch(session.id, headers, body)).status).toBe(404);
	expect(
		(
			await apiApp.request(
				`/api/sessions/${session.id}`,
				{ method: "DELETE", headers },
				env,
			)
		).status,
	).toBe(404);
	expect(await getDb(env).select().from(studySessions)).toHaveLength(2);
});
it("deletes immediately and exposes the removed hours as unplanned", async () => {
	const { headers, session } = await setup();
	expect(
		(
			await apiApp.request(
				`/api/sessions/${session.id}`,
				{ method: "DELETE", headers },
				env,
			)
		).status,
	).toBe(200);
	expect(
		await getDb(env).query.studySessions.findFirst({
			where: eq(studySessions.id, session.id),
		}),
	).toBeUndefined();
	expect(
		await (await apiApp.request("/api/deadlines", { headers }, env)).json(),
	).toMatchObject({ active: [{ unplannedMinutes: 180 }] });
	expect(
		(
			await apiApp.request(
				`/api/sessions/${session.id}`,
				{ method: "DELETE", headers },
				env,
			)
		).status,
	).toBe(404);
});
it("rolls back a merge when a concurrent change advances the plan revision", async () => {
	const { headers, session } = await setup();
	const database = new Proxy(env.DB, {
		get(target, key) {
			if (key === "batch")
				return async (statements: D1PreparedStatement[]) => {
					await getDb(env)
						.update(user)
						.set({ planRevision: 999 })
						.where(eq(user.id, session.userId));
					return target.batch(statements);
				};
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const response = await apiApp.request(
		`/api/sessions/${session.id}`,
		{
			method: "PATCH",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ date: "2026-10-27" }),
		},
		{ ...env, DB: database },
	);
	expect(response.status).toBe(409);
	expect(await getDb(env).select().from(studySessions)).toHaveLength(2);
	expect(
		await getDb(env).query.studySessions.findFirst({
			where: eq(studySessions.id, session.id),
		}),
	).toMatchObject({ minutes: 180, date: "2026-10-26" });
});
it("rejects a stale tick atomically if the plan changes before writing", async () => {
	const { headers, session } = await setup();
	const database = new Proxy(env.DB, {
		get(target, key) {
			if (key === "batch")
				return async (statements: D1PreparedStatement[]) => {
					await getDb(env)
						.update(user)
						.set({ planRevision: 999 })
						.where(eq(user.id, session.userId));
					return target.batch(statements);
				};
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const response = await apiApp.request(
		`/api/sessions/${session.id}`,
		{
			method: "PATCH",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ ticked: true }),
		},
		{ ...env, DB: database },
	);
	expect(response.status).toBe(409);
	expect(
		(
			await getDb(env).query.studySessions.findFirst({
				where: eq(studySessions.id, session.id),
			})
		)?.ticked,
	).toBe(false);
});
