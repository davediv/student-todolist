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
	notes: "Prompt",
};
function request(
	path: string,
	headers: Record<string, string>,
	method = "POST",
	body?: unknown,
	bindings = env,
) {
	return apiApp.request(
		path,
		{
			method,
			headers: { ...headers, "Content-Type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		bindings,
	);
}
async function setup() {
	const headers = await signedInHeaders("student@example.com", "2026-10-26");
	await request("/api/limits", headers, "PUT", defaultLimits);
	const created = await request("/api/deadlines", headers, "POST", input);
	const { deadline } = (await created.json()) as {
		deadline: { id: string; userId: string };
	};
	const [first] = await rows(deadline.id);
	await getDb(env)
		.update(studySessions)
		.set({ ticked: true, tickedAt: new Date("2026-10-26T08:00:00Z") })
		.where(eq(studySessions.id, first.id));
	return { headers, ...deadline };
}
function rows(id: string) {
	return getDb(env)
		.select()
		.from(studySessions)
		.where(eq(studySessions.deadlineId, id))
		.orderBy(asc(studySessions.date));
}
it("marks Done atomically, keeps ticked history and clears unticked work from days", async () => {
	const { headers, id } = await setup();
	const before = await rows(id);
	const response = await request(`/api/deadlines/${id}/done`, headers);
	expect(response.status).toBe(200);
	const result = (await response.json()) as {
		deadline: { status: string; doneAt: string };
	};
	expect(result.deadline.status).toBe("done");
	expect(Number.isFinite(Date.parse(result.deadline.doneAt))).toBe(true);
	expect(await rows(id)).toEqual([before[0]]);
	const days = await apiApp.request(
		"/api/days?from=2026-10-26&to=2026-10-30",
		{ headers },
		env,
	);
	expect(JSON.stringify(await days.json())).not.toContain(before[1].id);
	const again = await request(`/api/deadlines/${id}/done`, headers);
	expect(again.status).toBe(200);
	expect(await again.json()).toMatchObject({
		deadline: { doneAt: result.deadline.doneAt },
	});
	expect(await rows(id)).toEqual([before[0]]);
});
it("returns sorted Past due, Active and Done groups using each request's local date", async () => {
	const { headers, userId } = await setup();
	await getDb(env).delete(deadlines).where(eq(deadlines.userId, userId));
	await getDb(env)
		.insert(deadlines)
		.values([
			{
				...input,
				id: "active-late",
				userId,
				type: "assignment",
				dueDate: "2026-10-30",
			},
			{
				...input,
				id: "past-late",
				userId,
				type: "assignment",
				dueDate: "2026-10-25",
			},
			{
				...input,
				id: "done-late",
				userId,
				type: "assignment",
				dueDate: "2026-10-30",
				status: "done",
			},
			{
				...input,
				id: "active-today",
				userId,
				type: "assignment",
				dueDate: "2026-10-26",
			},
			{
				...input,
				id: "done-early",
				userId,
				type: "assignment",
				dueDate: "2026-10-20",
				status: "done",
			},
			{
				...input,
				id: "past-early",
				userId,
				type: "assignment",
				dueDate: "2026-10-24",
			},
		]);
	const response = await apiApp.request("/api/deadlines", { headers }, env);
	const groups = (await response.json()) as Record<string, { id: string }[]>;
	expect(groups.pastDue.map((row) => row.id)).toEqual([
		"past-early",
		"past-late",
	]);
	expect(groups.active.map((row) => row.id)).toEqual([
		"active-today",
		"active-late",
	]);
	expect(groups.done.map((row) => row.id)).toEqual(["done-early", "done-late"]);
	const tomorrow = await apiApp.request(
		"/api/deadlines",
		{ headers: { ...headers, "X-Local-Date": "2026-10-27" } },
		env,
	);
	expect(
		((await tomorrow.json()) as typeof groups).pastDue.map((row) => row.id),
	).toEqual(["past-early", "past-late", "active-today"]);
});
it.each([
	false,
	true,
])("deletes a deadline and all ticked and unticked sessions (Done=%s)", async (done) => {
	const { headers, id, userId } = await setup();
	if (done) await request(`/api/deadlines/${id}/done`, headers);
	await getDb(env)
		.insert(deadlines)
		.values({ ...input, type: "assignment", id: "keep", userId });
	const response = await request(`/api/deadlines/${id}`, headers, "DELETE");
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ deleted: id });
	expect(await rows(id)).toEqual([]);
	expect(await getDb(env).select().from(deadlines)).toMatchObject([
		{ id: "keep" },
	]);
	expect(
		(await apiApp.request(`/api/deadlines/${id}`, { headers }, env)).status,
	).toBe(404);
});
it("isolates another student's deadlines and returns 404 for missing IDs", async () => {
	const { headers, id } = await setup();
	const friend = await signedInHeaders("friend@example.com", "2026-10-26");
	const before = await rows(id);
	for (const target of [id, "missing"]) {
		for (const method of ["POST", "DELETE"]) {
			const path = `/api/deadlines/${target}${method === "POST" ? "/done" : ""}`;
			expect((await request(path, friend, method)).status).toBe(404);
		}
	}
	expect(await rows(id)).toEqual(before);
	expect((await request(`/api/deadlines/${id}/done`, {})).status).toBe(401);
	expect((await request(`/api/deadlines/${id}`, {}, "DELETE")).status).toBe(
		401,
	);
	expect(
		(await apiApp.request("/api/deadlines", { headers: friend }, env)).status,
	).toBe(200);
	expect(
		(await apiApp.request(`/api/deadlines/${id}`, { headers }, env)).status,
	).toBe(200);
});
it("extends a past-due active deadline through edit and restores its fresh active plan", async () => {
	const { headers, id } = await setup();
	const later = { ...headers, "X-Local-Date": "2026-11-01" };
	const response = await request(`/api/deadlines/${id}`, later, "PATCH", {
		dueDate: "2026-11-05",
	});
	expect(response.status).toBe(200);
	const groups = (await (
		await apiApp.request("/api/deadlines", { headers: later }, env)
	).json()) as { pastDue: unknown[]; active: { id: string }[] };
	expect(groups.pastDue).toEqual([]);
	expect(groups.active.map((row) => row.id)).toEqual([id]);
	expect(
		(await rows(id))
			.filter((row) => !row.ticked)
			.every((row) => row.date >= "2026-11-01" && row.date < "2026-11-05"),
	).toBe(true);
});
it.each([
	"done",
	"delete",
])("rolls back %s when another plan write changes the revision", async (action) => {
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
		`/api/deadlines/${id}${action === "done" ? "/done" : ""}`,
		headers,
		action === "done" ? "POST" : "DELETE",
		undefined,
		{ ...env, DB: database },
	);
	expect(response.status).toBe(409);
	expect(await rows(id)).toEqual(before);
	expect(
		(
			await getDb(env).query.deadlines.findFirst({
				where: eq(deadlines.id, id),
			})
		)?.status,
	).toBe("active");
});
