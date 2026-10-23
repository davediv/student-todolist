import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import {
	account,
	activityDays,
	daysOff,
	deadlines,
	series,
	studyLimits,
	studySessions,
	todos,
	verification,
} from "../../src/db/schema";
import { apiApp, createApiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

const today = "2026-10-23";
const deadlineInput = {
	title: "New work for B",
	type: "assignment" as const,
	dueDate: "2026-10-30",
	startDate: today,
	estimateMinutes: 180,
	notes: "B only",
};
const seriesInput = {
	title: "New weekly work for B",
	type: "reading",
	weekdays: [5],
	leadDays: 7,
	endDate: "2026-11-06",
	estimateMinutes: 180,
};
const limits = (minutes: number) => ({
	monday: minutes,
	tuesday: minutes,
	wednesday: minutes,
	thursday: minutes,
	friday: minutes,
	saturday: minutes,
	sunday: minutes,
});

type Resource = "deadline" | "session" | "todo" | "dayOff" | "series" | "scope";
type Route = {
	key: string;
	access: "protected" | "public" | "auth-gateway";
	behavior?: "foreign" | "read" | "create" | "bulk" | "account";
	resource?: Resource;
	body?: unknown;
};

// Every registered method/path must have an explicit access classification and
// an authenticated isolation case. Multiple Hono validator handlers share a key.
const routes: Route[] = [
	{ key: "GET /api/auth/*", access: "auth-gateway" },
	{ key: "POST /api/auth/*", access: "auth-gateway" },
	{ key: "GET /api/test/sign-in", access: "public" },
	{ key: "GET /api/health", access: "public" },
	{ key: "DELETE /api/account", access: "protected", behavior: "account" },
	{ key: "GET /api/me", access: "protected", behavior: "read" },
	{ key: "GET /api/limits", access: "protected", behavior: "read" },
	{
		key: "PUT /api/limits",
		access: "protected",
		behavior: "create",
		body: limits(120),
	},
	{ key: "GET /api/overdue", access: "protected", behavior: "read" },
	{
		key: "POST /api/replan/overdue",
		access: "protected",
		behavior: "bulk",
		body: {},
	},
	{
		key: "POST /api/replan/all/preview",
		access: "protected",
		behavior: "bulk",
		body: {},
	},
	{
		key: "POST /api/replan/all",
		access: "protected",
		behavior: "bulk",
		body: {},
	},
	{
		key: "POST /api/todos",
		access: "protected",
		behavior: "create",
		body: { title: "B's new todo", date: today },
	},
	{
		key: "PATCH /api/todos/:id",
		access: "protected",
		behavior: "foreign",
		resource: "todo",
		body: { title: "Attempted change", done: true },
	},
	{
		key: "DELETE /api/todos/:id",
		access: "protected",
		behavior: "foreign",
		resource: "todo",
	},
	{ key: "GET /api/days", access: "protected", behavior: "read" },
	{ key: "GET /api/days-off", access: "protected", behavior: "read" },
	{
		key: "POST /api/days-off",
		access: "protected",
		behavior: "create",
		body: { date: "2026-10-25", limitMinutes: 0 },
	},
	{
		key: "DELETE /api/days-off/:id",
		access: "protected",
		behavior: "foreign",
		resource: "dayOff",
	},
	{
		key: "PATCH /api/sessions/:id",
		access: "protected",
		behavior: "foreign",
		resource: "session",
		body: { ticked: true },
	},
	{
		key: "DELETE /api/sessions/:id",
		access: "protected",
		behavior: "foreign",
		resource: "session",
	},
	{ key: "GET /api/stats/weekly", access: "protected", behavior: "read" },
	{
		key: "POST /api/series/preview",
		access: "protected",
		behavior: "create",
		body: seriesInput,
	},
	{
		key: "POST /api/series",
		access: "protected",
		behavior: "create",
		body: seriesInput,
	},
	{
		key: "GET /api/series/:id",
		access: "protected",
		behavior: "foreign",
		resource: "series",
	},
	{
		key: "POST /api/series/:seriesId/occurrences/:id/preview",
		access: "protected",
		behavior: "foreign",
		resource: "scope",
		body: { estimateMinutes: 90 },
	},
	{
		key: "PATCH /api/series/:seriesId/occurrences/:id",
		access: "protected",
		behavior: "foreign",
		resource: "scope",
		body: { estimateMinutes: 90 },
	},
	{
		key: "DELETE /api/series/:seriesId/occurrences/:id",
		access: "protected",
		behavior: "foreign",
		resource: "scope",
	},
	{
		key: "POST /api/deadlines/preview",
		access: "protected",
		behavior: "create",
		body: deadlineInput,
	},
	{
		key: "POST /api/deadlines",
		access: "protected",
		behavior: "create",
		body: deadlineInput,
	},
	{ key: "GET /api/deadlines", access: "protected", behavior: "read" },
	{
		key: "GET /api/deadlines/:id",
		access: "protected",
		behavior: "foreign",
		resource: "deadline",
	},
	{
		key: "POST /api/deadlines/:id/preview",
		access: "protected",
		behavior: "foreign",
		resource: "deadline",
		body: { title: "Attempted change", estimateMinutes: 90 },
	},
	{
		key: "PATCH /api/deadlines/:id",
		access: "protected",
		behavior: "foreign",
		resource: "deadline",
		body: { title: "Attempted change", estimateMinutes: 90 },
	},
	{
		key: "POST /api/deadlines/:id/done",
		access: "protected",
		behavior: "foreign",
		resource: "deadline",
	},
	{
		key: "DELETE /api/deadlines/:id",
		access: "protected",
		behavior: "foreign",
		resource: "deadline",
	},
];

function checkRouteCoverage(
	registered: readonly { method: string; path: string }[],
) {
	const actual = [
		...new Set(
			registered
				.filter((route) => !(route.method === "ALL" && route.path === "/api/*"))
				.map((route) => `${route.method} ${route.path}`),
		),
	].sort();
	expect(actual).toEqual(routes.map((route) => route.key).sort());
}

type Student = Awaited<ReturnType<typeof seed>>;
async function seed(email: string, marker: "A" | "B") {
	const headers = await signedInHeaders(email, today);
	const me = await apiApp.request("/api/me", { headers }, env);
	const { id } = (await me.json()) as { id: string };
	const ids = {
		deadline: crypto.randomUUID(),
		pastDue: crypto.randomUUID(),
		done: crypto.randomUUID(),
		session: crypto.randomUUID(),
		tickedSession: crypto.randomUUID(),
		futureSession: crypto.randomUUID(),
		todo: crypto.randomUUID(),
		overdueTodo: crypto.randomUUID(),
		anytimeTodo: crypto.randomUUID(),
		dayOff: crypto.randomUUID(),
		series: crypto.randomUUID(),
	};
	const db = getDb(env);
	await db.insert(account).values({
		id: crypto.randomUUID(),
		userId: id,
		accountId: id,
		providerId: "google",
		accessToken: `${marker}-private-token`,
	});
	await db.insert(verification).values({
		id: crypto.randomUUID(),
		identifier: email,
		value: `${marker}-private-verification`,
		expiresAt: new Date(Date.now() + 60_000),
	});
	await db.insert(activityDays).values({ userId: id, date: "2026-10-22" });
	await db
		.insert(studyLimits)
		.values({ userId: id, ...limits(marker === "A" ? 720 : 180) });
	await db.insert(daysOff).values({
		id: ids.dayOff,
		userId: id,
		date: marker === "A" ? today : "2026-10-24",
		limitMinutes: marker === "A" ? 0 : 60,
	});
	await db.insert(series).values({
		id: ids.series,
		userId: id,
		title: `${marker}_PRIVATE_SERIES`,
		type: "reading",
		notes: `${marker}_PRIVATE_NOTES`,
		estimateMinutes: 120,
		weekdays: [5],
		leadDays: 7,
		endDate: "2026-11-06",
	});
	await db.insert(deadlines).values([
		{
			...deadlineInput,
			id: ids.deadline,
			userId: id,
			seriesId: ids.series,
			title: `${marker}_PRIVATE_DEADLINE`,
			estimateMinutes: marker === "A" ? 1200 : 120,
		},
		{
			...deadlineInput,
			id: ids.pastDue,
			userId: id,
			title: `${marker}_PRIVATE_PAST_DUE`,
			startDate: "2026-10-19",
			dueDate: "2026-10-22",
		},
		{
			...deadlineInput,
			id: ids.done,
			userId: id,
			title: `${marker}_PRIVATE_DONE`,
			status: "done",
			doneAt: new Date(),
		},
	]);
	await db.insert(studySessions).values([
		{
			id: ids.session,
			userId: id,
			deadlineId: ids.deadline,
			date: "2026-10-22",
			minutes: marker === "A" ? 120 : 60,
		},
		{
			id: ids.tickedSession,
			userId: id,
			deadlineId: ids.deadline,
			date: today,
			minutes: marker === "A" ? 720 : 30,
			ticked: true,
			tickedAt: new Date(),
		},
		{
			id: ids.futureSession,
			userId: id,
			deadlineId: ids.deadline,
			date: "2026-10-24",
			minutes: marker === "A" ? 90 : 30,
		},
	]);
	await db.insert(todos).values([
		{ id: ids.todo, userId: id, title: `${marker}_PRIVATE_TODO`, date: today },
		{
			id: ids.overdueTodo,
			userId: id,
			title: `${marker}_PRIVATE_OVERDUE_TODO`,
			date: "2026-10-22",
		},
		{
			id: ids.anytimeTodo,
			userId: id,
			title: `${marker}_PRIVATE_ANYTIME_TODO`,
		},
	]);
	return { id, email, ids, headers };
}
async function fixture() {
	return {
		a: await seed("student@example.com", "A"),
		b: await seed("friend@example.com", "B"),
	};
}

// Include auth, revision and activity rows as well as planner data. A denied
// request must not mutate either account, even as a side effect of middleware.
async function snapshot(student?: Student) {
	const result: Record<string, unknown[]> = {};
	for (const table of [
		"user",
		"session",
		"account",
		"verification",
		"activity_days",
		"study_limits",
		"days_off",
		"series",
		"deadlines",
		"study_sessions",
		"todos",
	]) {
		const column =
			table === "user"
				? "id"
				: table === "verification"
					? "identifier"
					: "user_id";
		const query = env.DB.prepare(
			`SELECT * FROM ${table}${student ? ` WHERE ${column} = ?` : ""} ORDER BY rowid`,
		);
		result[table] = (
			await (student
				? query.bind(table === "verification" ? student.email : student.id)
				: query
			).all()
		).results;
	}
	return result;
}
function resourcePath(route: Route, owner?: Student, anchor = owner) {
	const id =
		owner && route.resource && route.resource !== "scope"
			? owner.ids[route.resource]
			: anchor?.ids.deadline;
	return route.key
		.split(" ")[1]
		.replace(":seriesId", owner?.ids.series ?? "foreign-series")
		.replace(":id", id ?? "foreign-item");
}
function request(
	route: Route,
	headers: Record<string, string> = {},
	path = resourcePath(route),
	body = route.body,
) {
	return apiApp.request(
		path,
		{
			method: route.key.split(" ")[0],
			headers: {
				...headers,
				"Content-Type": "application/json",
				origin: env.BETTER_AUTH_URL,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		},
		env,
	);
}
function expectNoAData(body: unknown, a: Student) {
	const text = JSON.stringify(body);
	for (const privateValue of [
		a.id,
		a.email,
		...Object.values(a.ids),
		"A_PRIVATE",
		"A-private-token",
		"A-private-verification",
	])
		expect(text).not.toContain(privateValue);
}

it("classifies every registered API route exactly once, excluding only ALL middleware", () => {
	checkRouteCoverage(apiApp.routes);
	expect(
		routes
			.filter((route) => route.access === "protected")
			.every((route) => route.behavior),
	).toBe(true);
});
it.each([
	"get",
	"all",
] as const)("fails route coverage when a newly registered %s endpoint has no isolation case", (method) => {
	const app = createApiApp()[method]("/new-private-route", (c) =>
		c.json({ ok: true }),
	);
	expect(() => checkRouteCoverage(app.routes)).toThrow();
});

it.each(
	routes.filter((route) => route.access === "protected"),
)("requires a session for $key", async (route) => {
	const before = await snapshot();
	const response = await request(route, { "X-Local-Date": today });
	expect(response.status).toBe(401);
	expect(await response.json()).toMatchObject({
		error: { code: "unauthenticated" },
	});
	expect(await snapshot()).toEqual(before);
});

it("keeps health and non-production test sign-in public and delegates both auth wildcard methods", async () => {
	expect((await apiApp.request("/api/health", {}, env)).status).toBe(200);
	expect(
		(
			await apiApp.request(
				"/api/test/sign-in?email=student@example.com",
				{},
				env,
			)
		).status,
	).toBe(302);
	expect((await apiApp.request("/api/auth/get-session", {}, env)).status).toBe(
		200,
	);
	expect(
		(await apiApp.request("/api/auth/unknown-path", { method: "POST" }, env))
			.status,
	).toBe(404);
	for (const path of [
		"/api/test/sign-in?email=student@example.com",
		"/api/auth/test-sign-in?email=student@example.com",
	])
		expect(
			(await apiApp.request(path, {}, { ...env, ENVIRONMENT: "production" }))
				.status,
		).toBe(404);
});

it.each(
	routes.filter((route) => route.behavior === "foreign"),
)("hides A's ids from B without changing any rows: $key", async (route) => {
	const { a, b } = await fixture();
	const before = await snapshot();
	const targets =
		route.resource === "scope"
			? [
					[a, a],
					[a, b],
					[b, a],
				]
			: [[a, a]];
	for (const [owner, anchor] of targets) {
		const response = await request(
			route,
			b.headers,
			resourcePath(route, owner, anchor),
		);
		expect(
			response.status,
			`${route.key}: series=${owner.id}, anchor=${anchor.id}`,
		).toBe(404);
		expect(await response.json()).toMatchObject({
			error: { code: "not_found" },
		});
		expect(await snapshot()).toEqual(before);
	}
});

it("returns only B's profile, limits, deadline groups, day off, calendar, overdue work and weekly totals", async () => {
	const { a, b } = await fixture();
	const before = await snapshot();
	const results: Record<string, unknown> = {};
	for (const route of routes.filter((route) => route.behavior === "read")) {
		const path =
			resourcePath(route) +
			(route.key === "GET /api/days" ? "?from=2026-10-22&to=2026-10-25" : "");
		const response = await request(route, b.headers, path);
		expect(response.status, route.key).toBe(200);
		results[route.key] = await response.json();
		expectNoAData(results[route.key], a);
	}
	expect(results["GET /api/me"]).toMatchObject({ id: b.id, email: b.email });
	expect(results["GET /api/limits"]).toEqual(limits(180));
	expect(results["GET /api/deadlines"]).toMatchObject({
		active: [{ id: b.ids.deadline }],
		pastDue: [{ id: b.ids.pastDue }],
		done: [{ id: b.ids.done }],
	});
	expect(results["GET /api/days-off"]).toEqual([
		expect.objectContaining({
			id: b.ids.dayOff,
			userId: b.id,
			date: "2026-10-24",
			limitMinutes: 60,
		}),
	]);
	expect(results["GET /api/overdue"]).toMatchObject({
		sessions: [{ id: b.ids.session, minutes: 60 }],
		todos: [{ id: b.ids.overdueTodo }],
	});
	expect(results["GET /api/days"]).toMatchObject({
		days: [
			{
				date: "2026-10-22",
				sessions: [{ id: b.ids.session }],
				todos: [{ id: b.ids.overdueTodo }],
			},
			{
				date: today,
				isDayOff: false,
				limitMinutes: 180,
				sessions: [{ id: b.ids.tickedSession }],
				todos: [{ id: b.ids.todo }],
			},
			{
				date: "2026-10-24",
				isDayOff: true,
				limitMinutes: 60,
				sessions: [{ id: b.ids.futureSession }],
			},
			{ date: "2026-10-25", sessions: [] },
		],
		anytime: [{ id: b.ids.anytimeTodo }],
	});
	expect(results["GET /api/stats/weekly"]).toMatchObject({
		weeks: [
			{ startDate: "2026-10-19", doneMinutes: 30, plannedMinutes: 120 },
			{ doneMinutes: 0, plannedMinutes: 0 },
			{ doneMinutes: 0, plannedMinutes: 0 },
			{ doneMinutes: 0, plannedMinutes: 0 },
		],
	});
	expect(await snapshot()).toEqual(before);
});

it.each(
	routes.filter((route) => route.behavior === "create"),
)("does not trust client ownership when previewing or creating: $key", async (route) => {
	const { a, b } = await fixture();
	const beforeA = await snapshot(a);
	const beforeAll = await snapshot();
	const forged = {
		...(route.body as object),
		userId: a.id,
		id: a.ids.deadline,
		seriesId: a.ids.series,
		deadlineId: a.ids.deadline,
	};
	const response = await request(route, b.headers, resourcePath(route), forged);
	// Strict todo inputs reject unknown ownership fields; other schemas strip
	// them. Either way an attacker cannot select a different owner or row id.
	const rejected = route.key === "POST /api/todos";
	const preview = route.key.endsWith("/preview");
	expect(response.status).toBe(
		rejected ? 400 : preview || route.key.startsWith("PUT") ? 200 : 201,
	);
	const result = await response.json();
	expectNoAData(result, a);
	expect(await snapshot(a)).toEqual(beforeA);
	if (preview || rejected) expect(await snapshot()).toEqual(beforeAll);
	else {
		const after = await snapshot();
		for (const table of [
			"deadlines",
			"study_sessions",
			"series",
			"todos",
			"days_off",
			"study_limits",
		])
			for (const row of after[table]) {
				if (
					!beforeAll[table].some(
						(before) => JSON.stringify(before) === JSON.stringify(row),
					)
				)
					expect(row).toMatchObject({ user_id: b.id });
			}
	}
	if (route.key.startsWith("POST /api/deadlines"))
		expect(result).toMatchObject({
			sessions: [
				{ date: today, minutes: 150 },
				{ date: "2026-10-24", minutes: 30 },
			],
			shortfallMinutes: 0,
		});
	if (route.key.startsWith("POST /api/series"))
		expect(result).toMatchObject({
			occurrences: [
				{
					dueDate: "2026-10-30",
					sessions: [
						{ date: today, minutes: 150 },
						{ date: "2026-10-24", minutes: 30 },
					],
					shortfallMinutes: 0,
				},
				{
					dueDate: "2026-11-06",
					sessions: [{ date: "2026-10-30", minutes: 180 }],
					shortfallMinutes: 0,
				},
			],
		});
	if (rejected) {
		const valid = await request(route, b.headers);
		expect(valid.status).toBe(201);
		expect(await valid.json()).toMatchObject({ todo: { userId: b.id } });
		expect(await snapshot(a)).toEqual(beforeA);
	}
});

it.each(
	routes.filter((route) => route.behavior === "bulk"),
)("previews or replans only B's work even with A's userId: $key", async (route) => {
	const { a, b } = await fixture();
	const beforeA = await snapshot(a);
	const before = await snapshot();
	const response = await request(route, b.headers, resourcePath(route), {
		userId: a.id,
	});
	expect(response.status).toBe(200);
	const result = await response.json();
	expectNoAData(result, a);
	expect(result).toMatchObject({
		plans: [expect.objectContaining({ deadlineId: b.ids.deadline })],
	});
	expect(await snapshot(a)).toEqual(beforeA);
	if (route.key.endsWith("/preview")) expect(await snapshot()).toEqual(before);
});

it.each([
	"/api/replan/all/preview",
	"/api/replan/all",
])("rejects a foreign pending deadline without writes: %s", async (path) => {
	const { a, b } = await fixture();
	const before = await snapshot();
	const response = await apiApp.request(
		path,
		{
			method: "POST",
			headers: { ...b.headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				userId: a.id,
				pending: { id: a.ids.deadline, input: deadlineInput },
			}),
		},
		env,
	);
	expect(response.status).toBe(404);
	expect(await snapshot()).toEqual(before);
});

it("creates a pending deadline for B during bulk save despite forged ownership fields", async () => {
	const { a, b } = await fixture();
	const beforeA = await snapshot(a);
	const response = await apiApp.request(
		"/api/replan/all",
		{
			method: "POST",
			headers: { ...b.headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				userId: a.id,
				pending: {
					input: {
						...deadlineInput,
						id: a.ids.deadline,
						userId: a.id,
						seriesId: a.ids.series,
					},
				},
			}),
		},
		env,
	);
	expect(response.status).toBe(200);
	const result = (await response.json()) as { pendingDeadlineId: string };
	expectNoAData(result, a);
	expect(result.pendingDeadlineId).not.toBe(a.ids.deadline);
	const owned = await snapshot(b);
	expect(owned.deadlines).toContainEqual(
		expect.objectContaining({
			id: result.pendingDeadlineId,
			user_id: b.id,
			series_id: null,
		}),
	);
	expect(await snapshot(a)).toEqual(beforeA);
});

it("ignores a forged account target and deletes only the authenticated student", async () => {
	const { a, b } = await fixture();
	const beforeA = await snapshot(a);
	const response = await apiApp.request(
		`/api/account?userId=${a.id}`,
		{
			method: "DELETE",
			headers: { ...b.headers, "Content-Type": "application/json" },
			body: JSON.stringify({ userId: a.id, email: a.email }),
		},
		env,
	);
	expect(response.status).toBe(204);
	for (const rows of Object.values(await snapshot(b))) expect(rows).toEqual([]);
	expect(await snapshot(a)).toEqual(beforeA);
	expect(
		(await apiApp.request("/api/me", { headers: a.headers }, env)).status,
	).toBe(200);
	expect(
		(await apiApp.request("/api/me", { headers: b.headers }, env)).status,
	).toBe(401);
});

it("auth session lookup and sign-out act on B's cookie, not a supplied userId", async () => {
	const { a, b } = await fixture();
	const beforeA = await snapshot(a);
	const response = await apiApp.request(
		`/api/auth/get-session?userId=${a.id}`,
		{ headers: b.headers },
		env,
	);
	expect(response.status).toBe(200);
	const result = await response.json();
	expect(result).toMatchObject({
		user: { id: b.id, email: b.email },
		session: { userId: b.id },
	});
	expectNoAData(result, a);
	const signedOut = await apiApp.request(
		"/api/auth/sign-out",
		{
			method: "POST",
			headers: {
				...b.headers,
				origin: env.BETTER_AUTH_URL,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ userId: a.id }),
		},
		env,
	);
	expect(signedOut.status).toBe(200);
	expect(
		(await apiApp.request("/api/me", { headers: b.headers }, env)).status,
	).toBe(401);
	expect(
		(await apiApp.request("/api/me", { headers: a.headers }, env)).status,
	).toBe(200);
	expect(await snapshot(a)).toEqual(beforeA);
});
