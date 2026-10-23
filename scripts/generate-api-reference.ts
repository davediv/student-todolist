import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, request } from "@playwright/test";
import { planDeadline } from "../src/lib/planner";
import { apiApp } from "../src/server/api";
import { apiRouteContracts } from "./api-route-contracts";
import { startPerfServer } from "./perf-support";

type Capture = { request: string; response: string; body: unknown };
type Version = { revision: number; today: string };
type Plan = {
	sessions: { date: string; minutes: number }[];
	shortfallMinutes: number;
};
type Detail = {
	deadline: { id: string };
	sessions: { id: string; ticked: boolean }[];
};
const root = fileURLToPath(new URL("../", import.meta.url));
const email = "performance@e2e.example";
const initialToday = "2026-10-19";
const input = {
	title: "Essay",
	type: "assignment",
	startDate: initialToday,
	dueDate: "2026-10-23",
	estimateMinutes: 360,
	notes: "API reference fixture",
};
const limits = {
	monday: 180,
	tuesday: 180,
	wednesday: 180,
	thursday: 180,
	friday: 180,
	saturday: 180,
	sunday: 180,
};
const registered = [
	...new Set(
		apiApp.routes
			.filter((route) => !(route.method === "ALL" && route.path === "/api/*"))
			.map((route) => `${route.method} ${route.path}`),
	),
].sort();
assert.deepEqual(
	apiRouteContracts.map((route) => route.key).sort(),
	registered,
	"API contracts must exactly match the isolation suite's Hono route-table coverage",
);

function matches(key: string, method: string, path: string) {
	const [expectedMethod, pattern] = key.split(" ");
	const regex = pattern
		.split("/")
		.map((segment) =>
			segment === "*"
				? ".*"
				: segment.startsWith(":")
					? "[^/]+"
					: segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		)
		.join("/");
	return (
		expectedMethod === method &&
		new RegExp(`^${regex}$`).test(new URL(path, "http://localhost").pathname)
	);
}
function redact(_key: string, value: unknown): unknown {
	return /^(token|accessToken|refreshToken|idToken|secret|password)$/i.test(
		_key,
	) && value != null
		? "[redacted]"
		: value;
}
function example(capture: Capture) {
	return `Request captured from the local app:\n\n\`\`\`http\n${capture.request}\n\`\`\`\n\nResponse captured from the local app:\n\n\`\`\`http\n${capture.response}\n\`\`\``;
}

const server = await startPerfServer(3024);
try {
	const api = await request.newContext({ baseURL: server.url });
	const anonymous = await request.newContext({ baseURL: server.url });
	try {
		let today = initialToday;
		const captures = new Map<string, Capture>();
		const errors: { label: string; capture: Capture }[] = [];
		async function perform(
			client: APIRequestContext,
			method: string,
			path: string,
			expected: number,
			body?: unknown,
			extraHeaders: Record<string, string> = {},
		) {
			const cookies = (await client.storageState()).cookies;
			const headers: Record<string, string> = {
				"X-Local-Date": today,
				Origin: server.url,
				...extraHeaders,
			};
			if (body !== undefined) headers["Content-Type"] = "application/json";
			const response = await client.fetch(path, {
				method,
				headers,
				maxRedirects: 0,
				...(body === undefined
					? {}
					: { data: typeof body === "string" ? Buffer.from(body) : body }),
			});
			const raw = await response.text();
			assert.equal(response.status(), expected, `${method} ${path}: ${raw}`);
			const parsed: unknown = raw ? JSON.parse(raw) : undefined;
			const requestHeaders = Object.entries(headers).map(
				([name, value]) => `${name}: ${value}`,
			);
			if (cookies.length)
				requestHeaders.push("Cookie: [redacted local cookie values]");
			const responseHeaders = Object.entries(response.headers())
				.filter(([name]) =>
					["content-type", "cache-control", "location"].includes(name),
				)
				.map(([name, value]) => `${name}: ${value}`);
			if (response.headers()["set-cookie"])
				responseHeaders.push("set-cookie: [redacted local cookie values]");
			return {
				request: [
					`${method} ${path} HTTP/1.1`,
					...requestHeaders,
					...(body === undefined
						? []
						: [
								"",
								typeof body === "string"
									? body
									: JSON.stringify(body, redact, 2),
							]),
				].join("\n"),
				response: [
					`HTTP ${response.status()}`,
					...responseHeaders,
					"",
					raw ? JSON.stringify(parsed, redact, 2) : "(empty body)",
				].join("\n"),
				body: parsed,
			};
		}
		async function capture<T = unknown>(
			key: string,
			path: string,
			expected = 200,
			body?: unknown,
		) {
			assert(!captures.has(key), `Duplicate example: ${key}`);
			const method = key.split(" ")[0];
			assert(
				matches(key, method, path),
				`Concrete request does not match ${key}: ${path}`,
			);
			const result = await perform(api, method, path, expected, body);
			captures.set(key, result);
			return result.body as T;
		}
		async function error(
			label: string,
			client: APIRequestContext,
			method: string,
			path: string,
			status: number,
			body?: unknown,
			headers?: Record<string, string>,
		) {
			errors.push({
				label,
				capture: await perform(client, method, path, status, body, headers),
			});
		}
		await capture("GET /api/health", "/api/health");
		await error("401 unauthenticated", anonymous, "GET", "/api/me", 401);
		await capture(
			"GET /api/test/sign-in",
			`/api/test/sign-in?email=${encodeURIComponent(email)}`,
			302,
		);
		await capture("GET /api/auth/*", "/api/auth/get-session");
		await capture("POST /api/auth/*", "/api/auth/sign-out", 200, {});
		await perform(
			api,
			"GET",
			`/api/test/sign-in?email=${encodeURIComponent(email)}`,
			302,
		);
		await capture("GET /api/me", "/api/me");
		await capture("GET /api/limits", "/api/limits");
		await error(
			"409 limits_required",
			api,
			"POST",
			"/api/deadlines/preview",
			409,
			input,
		);
		await error(
			"400 invalid_local_date",
			api,
			"GET",
			"/api/me",
			400,
			undefined,
			{ "X-Local-Date": "invalid" },
		);
		await capture("PUT /api/limits", "/api/limits", 200, limits);
		await error("400 validation", api, "POST", "/api/deadlines/preview", 400, {
			...input,
			estimateMinutes: 1,
		});
		await error("404 not_found", api, "GET", "/api/deadlines/missing", 404);
		await error(
			"500 internal for malformed JSON on a validator route",
			api,
			"POST",
			"/api/todos",
			500,
			"{",
		);
		const preview = await capture<Plan>(
			"POST /api/deadlines/preview",
			"/api/deadlines/preview",
			200,
			input,
		);
		const engine = planDeadline({
			today: initialToday,
			weekdayLimits: { 0: 180, 1: 180, 2: 180, 3: 180, 4: 180, 5: 180, 6: 180 },
			sessions: [],
			deadline: {
				id: "assignment",
				startDate: input.startDate,
				dueDate: input.dueDate,
				remainingMinutes: input.estimateMinutes,
			},
		});
		assert.deepEqual(
			preview.sessions,
			engine.sessions.map(({ date, minutes }) => ({ date, minutes })),
		);
		assert.deepEqual(preview.sessions, [
			{ date: initialToday, minutes: 180 },
			{ date: "2026-10-20", minutes: 180 },
		]);
		assert.equal(preview.shortfallMinutes, engine.shortfallMinutes);
		assert.equal(preview.shortfallMinutes, 0);
		const created = await capture<{ deadline: { id: string } }>(
			"POST /api/deadlines",
			"/api/deadlines",
			201,
			input,
		);
		const deadlineId = created.deadline.id;
		await capture("GET /api/deadlines", "/api/deadlines");
		await capture("GET /api/deadlines/:id", `/api/deadlines/${deadlineId}`);
		const edit = await capture<{ previewVersion: Version }>(
			"POST /api/deadlines/:id/preview",
			`/api/deadlines/${deadlineId}/preview`,
			200,
			{ estimateMinutes: 420 },
		);
		await capture(
			"PATCH /api/deadlines/:id",
			`/api/deadlines/${deadlineId}`,
			200,
			{ estimateMinutes: 420, previewVersion: edit.previewVersion },
		);
		await error(
			"409 plan_changed",
			api,
			"PATCH",
			`/api/deadlines/${deadlineId}`,
			409,
			{ estimateMinutes: 420, previewVersion: edit.previewVersion },
		);
		const detail = (
			await perform(api, "GET", `/api/deadlines/${deadlineId}`, 200)
		).body as Detail;
		assert(
			detail.sessions.length >= 3,
			"Fixture must contain three sessions after the seven-hour edit",
		);
		await capture(
			"PATCH /api/sessions/:id",
			`/api/sessions/${detail.sessions[0].id}`,
			200,
			{ ticked: true },
		);
		await error(
			"409 session_ticked",
			api,
			"PATCH",
			`/api/sessions/${detail.sessions[0].id}`,
			409,
			{ minutes: 60 },
		);
		await capture(
			"DELETE /api/sessions/:id",
			`/api/sessions/${detail.sessions[2].id}`,
		);
		const todo = await capture<{ todo: { id: string } }>(
			"POST /api/todos",
			"/api/todos",
			201,
			{ title: "Read notes", date: initialToday },
		);
		await capture("PATCH /api/todos/:id", `/api/todos/${todo.todo.id}`, 200, {
			title: "Review notes",
		});
		const dayOff = await capture<{ id: string }>(
			"POST /api/days-off",
			"/api/days-off",
			201,
			{ date: "2026-10-20", limitMinutes: 60 },
		);
		await error("409 duplicate", api, "POST", "/api/days-off", 409, {
			date: "2026-10-20",
			limitMinutes: 0,
		});
		await capture("GET /api/days-off", "/api/days-off");
		await capture(
			"GET /api/days",
			`/api/days?from=${initialToday}&to=2026-10-23`,
		);
		await capture("GET /api/stats/weekly", "/api/stats/weekly");
		today = "2026-10-21";
		await capture("GET /api/overdue", "/api/overdue");
		await capture("POST /api/replan/overdue", "/api/replan/overdue");
		const all = await capture<{ previewVersion: Version }>(
			"POST /api/replan/all/preview",
			"/api/replan/all/preview",
			200,
			{},
		);
		await capture("POST /api/replan/all", "/api/replan/all", 200, {
			previewVersion: all.previewVersion,
		});
		const seriesInput = {
			title: "Weekly reading",
			type: "reading",
			estimateMinutes: 60,
			weekdays: [5],
			leadDays: 7,
			endDate: "2026-11-06",
			notes: "API reference fixture",
		};
		const seriesPreview = await capture<{ previewVersion: Version }>(
			"POST /api/series/preview",
			"/api/series/preview",
			200,
			seriesInput,
		);
		const series = await capture<{
			series: { id: string };
			occurrences: { id: string }[];
		}>("POST /api/series", "/api/series", 201, {
			...seriesInput,
			previewVersion: seriesPreview.previewVersion,
		});
		assert(
			series.occurrences.length >= 2,
			"Fixture must create at least two recurring occurrences",
		);
		await capture("GET /api/series/:id", `/api/series/${series.series.id}`);
		const anchor = `/api/series/${series.series.id}/occurrences/${series.occurrences[1].id}`;
		const changes = { title: "Weekly reading revised", estimateMinutes: 90 };
		const scope = await capture<{ previewVersion: Version }>(
			"POST /api/series/:seriesId/occurrences/:id/preview",
			`${anchor}/preview`,
			200,
			changes,
		);
		await capture("PATCH /api/series/:seriesId/occurrences/:id", anchor, 200, {
			...changes,
			previewVersion: scope.previewVersion,
		});
		await capture("DELETE /api/series/:seriesId/occurrences/:id", anchor);
		await capture(
			"POST /api/deadlines/:id/done",
			`/api/deadlines/${deadlineId}/done`,
		);
		await error(
			"409 deadline_done",
			api,
			"PATCH",
			`/api/deadlines/${deadlineId}`,
			409,
			{ title: "Cannot edit Done work" },
		);
		await capture("DELETE /api/deadlines/:id", `/api/deadlines/${deadlineId}`);
		await capture("DELETE /api/todos/:id", `/api/todos/${todo.todo.id}`);
		await capture("DELETE /api/days-off/:id", `/api/days-off/${dayOff.id}`);
		await capture("DELETE /api/account", "/api/account", 204);
		assert.deepEqual(
			[...captures.keys()].sort(),
			registered,
			"Every route needs exactly one captured example",
		);
		const index = [
			"| Method/path | Authentication |",
			"| --- | --- |",
			...apiRouteContracts.map(
				(route) => `| \`${route.key}\` | ${route.access} |`,
			),
		].join("\n");
		const routes = apiRouteContracts
			.map((route) => {
				const result = captures.get(route.key);
				assert(result);
				return `### ${route.key}\n\n**Authentication:** ${route.access}.\n\n**Request:** ${route.request}\n\n**Response:** ${route.response}\n\n**Errors:** ${route.errors}\n\n${example(result)}`;
			})
			.join("\n\n");
		const worked = `| Day | Study minutes | Hours |\n| --- | --- | --- |\n${preview.sessions.map((row) => `| ${row.date} | ${row.minutes} | ${row.minutes / 60}h |`).join("\n")}\n\nShortfall: **${preview.shortfallMinutes} minutes**. The captured \`POST /api/deadlines/preview\` example above contains the exact request and response.`;
		const template = await readFile(
			new URL("./api-reference.md", import.meta.url),
			"utf8",
		);
		let document = template;
		for (const [marker, value] of [
			["<!-- ROUTES -->", `${index}\n\n${routes}`],
			[
				"<!-- ERRORS -->",
				errors
					.map((row) => `#### ${row.label}\n\n${example(row.capture)}`)
					.join("\n\n"),
			],
			["<!-- WORKED_EXAMPLE -->", worked],
		]) {
			assert.equal(
				document.split(marker).length,
				2,
				`Template needs exactly one ${marker}`,
			);
			document = document.replace(marker, () => value);
		}
		const documented = [
			...document.matchAll(
				/^### ((?:GET|POST|PUT|PATCH|DELETE|ALL) \/api\S*)$/gm,
			),
		]
			.map((match) => match[1])
			.sort();
		assert.deepEqual(
			documented,
			registered,
			"Rendered documentation must exactly cover the route table",
		);
		await mkdir(`${root}/docs`, { recursive: true });
		await writeFile(`${root}/docs/API.md`, document);
		console.log(
			JSON.stringify({
				document: "docs/API.md",
				routes: captures.size,
				errorExamples: errors.length,
				workedExample: "HTTP preview equals planner and unit expectation",
				isolatedLocalWorker: true,
			}),
		);
	} finally {
		await api.dispose();
		await anonymous.dispose();
	}
} finally {
	await server.close();
}
