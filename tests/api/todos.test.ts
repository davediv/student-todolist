import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { todos, user } from "../../src/db/schema";
import { defaultLimits } from "../../src/lib/limits";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

type Todo = {
	id: string;
	title: string;
	date: string | null;
	done: boolean;
	doneAt: string | null;
	doneOn: string | null;
	userId: string;
};
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
	return headers;
}
function write(
	path: string,
	headers: Record<string, string>,
	value: unknown,
	method = "POST",
) {
	return apiApp.request(
		path,
		{
			method,
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(value),
		},
		env,
	);
}
async function create(
	headers: Record<string, string>,
	value: unknown = { title: "Email professor" },
): Promise<Todo> {
	const response = await write("/api/todos", headers, value);
	expect(response.status).toBe(201);
	return ((await response.json()) as { todo: Todo }).todo;
}
function days(
	headers: Record<string, string>,
	from = "2026-10-26",
	to = "2026-10-27",
) {
	return apiApp.request(`/api/days?from=${from}&to=${to}`, { headers }, env);
}
it("creates trimmed undated/dates todos and keeps all todo minutes outside the study limit", async () => {
	const headers = await setup();
	const anytime = await create(headers, { title: "  Email professor  " });
	expect(anytime).toMatchObject({
		title: "Email professor",
		date: null,
		done: false,
		doneAt: null,
		doneOn: null,
	});
	const dated = await create(headers, {
		title: "Buy lab coat",
		date: "2026-10-27",
	});
	expect(await (await days(headers)).json()).toMatchObject({
		days: [
			{
				date: "2026-10-26",
				limitMinutes: 180,
				plannedMinutes: 0,
				overLimit: false,
				todos: [],
			},
			{ date: "2026-10-27", plannedMinutes: 0, todos: [{ id: dated.id }] },
		],
		anytime: [{ id: anytime.id }],
	});
});
it.each([
	{ title: "" },
	{ title: "   " },
	{ title: "a".repeat(121) },
	{ title: "Title", date: "2026-10-25" },
	{ title: "Title", date: "2026-02-30" },
	{ title: "Title", date: "tomorrow" },
	{ title: "Title", date: "" },
])("rejects invalid creation inputs (%j)", async (body) => {
	const headers = await setup();
	expect((await write("/api/todos", headers, body)).status).toBe(400);
	expect(await getDb(env).select().from(todos)).toEqual([]);
});
it("ticks and unticks with the local completion day, hiding completed dated and undated todos tomorrow", async () => {
	const headers = await setup();
	const anytime = await create(headers);
	const dated = await create(headers, {
		title: "Tomorrow task",
		date: "2026-10-27",
	});
	for (const todo of [anytime, dated]) {
		const response = await write(
			`/api/todos/${todo.id}`,
			headers,
			{ done: true },
			"PATCH",
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			todo: { done: true, doneAt: expect.any(String), doneOn: "2026-10-26" },
		});
	}
	expect(await (await days(headers)).json()).toMatchObject({
		anytime: [{ id: anytime.id, done: true }],
		days: [{ todos: [] }, { todos: [{ id: dated.id, done: true }] }],
	});
	const tomorrow = { ...headers, "X-Local-Date": "2026-10-27" };
	expect(
		await (await days(tomorrow, "2026-10-26", "2026-10-28")).json(),
	).toMatchObject({
		anytime: [],
		days: [{ todos: [] }, { todos: [] }, { todos: [] }],
	});
	expect(
		await (
			await apiApp.request("/api/overdue", { headers: tomorrow }, env)
		).json(),
	).toMatchObject({ todos: [] });
	await write(`/api/todos/${anytime.id}`, tomorrow, { done: false }, "PATCH");
	expect(
		await getDb(env).query.todos.findFirst({ where: eq(todos.id, anytime.id) }),
	).toMatchObject({ done: false, doneAt: null, doneOn: null });
	expect(await (await days(tomorrow)).json()).toMatchObject({
		anytime: [{ id: anytime.id, done: false }],
	});
});
it("renames and ticks overdue todos without rejecting their unchanged past date, then re-dates or unsets dates", async () => {
	const headers = await setup();
	const todo = await create(headers, {
		title: "Email professor",
		date: "2026-10-26",
	});
	const later = { ...headers, "X-Local-Date": "2026-10-28" };
	expect(
		await (
			await apiApp.request("/api/overdue", { headers: later }, env)
		).json(),
	).toMatchObject({ todos: [{ id: todo.id }] });
	expect(
		(
			await write(
				`/api/todos/${todo.id}`,
				later,
				{ title: "Ask for reading list", date: todo.date },
				"PATCH",
			)
		).status,
	).toBe(200);
	expect(
		(await write(`/api/todos/${todo.id}`, later, { done: true }, "PATCH"))
			.status,
	).toBe(200);
	expect(
		await (
			await apiApp.request("/api/overdue", { headers: later }, env)
		).json(),
	).toMatchObject({ todos: [] });
	await write(
		`/api/todos/${todo.id}`,
		later,
		{ done: false, date: "2026-10-28" },
		"PATCH",
	);
	expect(
		await (await days(later, "2026-10-28", "2026-10-28")).json(),
	).toMatchObject({
		days: [
			{ todos: [{ id: todo.id, title: "Ask for reading list", done: false }] },
		],
	});
	await write(`/api/todos/${todo.id}`, later, { date: null }, "PATCH");
	expect(await (await days(later)).json()).toMatchObject({
		anytime: [{ id: todo.id, date: null }],
	});
	expect(
		(
			await write(
				`/api/todos/${todo.id}`,
				later,
				{ date: "2026-10-27" },
				"PATCH",
			)
		).status,
	).toBe(400);
});
it("isolates patch/delete and all placements from another student", async () => {
	const headers = await setup();
	const todo = await create(headers);
	await create(headers, { title: "Dated", date: "2026-10-26" });
	const other = await signedInHeaders("friend@example.com", "2026-10-28");
	await write("/api/limits", other, defaultLimits, "PUT");
	for (const id of [todo.id, "missing"]) {
		expect(
			(await write(`/api/todos/${id}`, other, { done: true }, "PATCH")).status,
		).toBe(404);
		expect(
			(
				await apiApp.request(
					`/api/todos/${id}`,
					{ method: "DELETE", headers: other },
					env,
				)
			).status,
		).toBe(404);
	}
	expect(await (await days(other)).json()).toMatchObject({
		anytime: [],
		days: [{ todos: [] }, { todos: [] }],
	});
	expect(
		await (
			await apiApp.request("/api/overdue", { headers: other }, env)
		).json(),
	).toMatchObject({ todos: [] });
	expect(await getDb(env).select().from(todos)).toHaveLength(2);
});
it("deletes todos and cascades a user's remaining todos", async () => {
	const headers = await setup();
	const first = await create(headers);
	await create(headers, { title: "Another" });
	expect(
		(
			await apiApp.request(
				`/api/todos/${first.id}`,
				{ method: "DELETE", headers },
				env,
			)
		).status,
	).toBe(200);
	expect(await getDb(env).select().from(todos)).toHaveLength(1);
	await getDb(env).delete(user).where(eq(user.id, first.userId));
	expect(await getDb(env).select().from(todos)).toEqual([]);
	const explain = await env.DB.prepare(
		"EXPLAIN QUERY PLAN SELECT * FROM todos WHERE user_id=? AND date=?",
	)
		.bind("student", "2026-10-26")
		.all();
	expect(JSON.stringify(explain.results)).toContain("todos_user_date_idx");
});
it("re-planning overdue sessions leaves todos unchanged", async () => {
	const headers = await setup();
	await create(headers, { title: "Buy lab coat", date: "2026-10-26" });
	await create(headers);
	const before = await getDb(env).select().from(todos);
	const later = { ...headers, "X-Local-Date": "2026-10-28" };
	expect(
		(
			await apiApp.request(
				"/api/replan/overdue",
				{ method: "POST", headers: later },
				env,
			)
		).status,
	).toBe(200);
	expect(await getDb(env).select().from(todos)).toEqual(before);
	expect(
		await (
			await apiApp.request("/api/overdue", { headers: later }, env)
		).json(),
	).toMatchObject({ todos: [{ title: "Buy lab coat" }] });
});
it.each([
	{},
	{ title: "" },
	{ done: "true" },
	{ date: "2026-02-30" },
])("rejects invalid updates (%j)", async (body) => {
	const headers = await setup();
	const todo = await create(headers);
	expect(
		(await write(`/api/todos/${todo.id}`, headers, body, "PATCH")).status,
	).toBe(400);
});
