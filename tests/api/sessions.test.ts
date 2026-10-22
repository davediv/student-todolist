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
	expect(await response.json()).toMatchObject([
		{ tickedMinutes: 180, estimateMinutes: 360 },
	]);
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
	).toMatchObject([{ tickedMinutes: 0 }]);
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
	{ minutes: 60 },
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
