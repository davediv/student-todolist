import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { studySessions } from "../../src/db/schema";
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
			body: JSON.stringify({ ...defaultLimits, tuesday: 0 }),
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
				estimateMinutes: 240,
			}),
		},
		env,
	);
	expect(response.status).toBe(201);
	return headers;
}
it("includes empty dates and weekday limits, counts both tick states, and marks excess time", async () => {
	const headers = await setup();
	const db = getDb(env);
	const [session] = await db.select().from(studySessions);
	await db
		.update(studySessions)
		.set({ ticked: true, minutes: 210 })
		.where(eq(studySessions.id, session.id));
	const response = await apiApp.request(
		"/api/days?from=2026-10-26&to=2026-10-28",
		{ headers },
		env,
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		days: [
			{
				date: "2026-10-26",
				limitMinutes: 180,
				plannedMinutes: 210,
				overLimit: true,
				sessions: [
					{
						id: session.id,
						title: "Essay",
						type: "assignment",
						dueDate: "2026-10-30",
						ticked: true,
					},
				],
			},
			{
				date: "2026-10-27",
				limitMinutes: 0,
				plannedMinutes: 0,
				overLimit: false,
				sessions: [],
			},
			{
				date: "2026-10-28",
				limitMinutes: 180,
				plannedMinutes: 60,
				overLimit: false,
				sessions: [{ ticked: false }],
			},
		],
	});
});
it("allows exactly 31 inclusive dates and isolates another student's sessions", async () => {
	await setup();
	const headers = await signedInHeaders("friend@example.com", "2026-10-26");
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
		"/api/days?from=2026-10-01&to=2026-10-31",
		{ headers },
		env,
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as { days: { sessions: unknown[] }[] };
	expect(body.days).toHaveLength(31);
	expect(body.days.flatMap((day) => day.sessions)).toEqual([]);
});
it.each([
	"from=2026-10-01&to=2026-11-01",
	"from=2026-10-28&to=2026-10-27",
	"from=2026-02-30&to=2026-03-01",
	"from=tomorrow&to=2026-10-28",
	"from=2026-10-28",
	"",
])("rejects invalid date ranges (%s)", async (query) => {
	const headers = await signedInHeaders();
	expect(
		(await apiApp.request(`/api/days?${query}`, { headers }, env)).status,
	).toBe(400);
});
it("requires study limits for the day totals", async () => {
	const headers = await signedInHeaders();
	expect(
		(
			await apiApp.request(
				"/api/days?from=2026-10-26&to=2026-10-26",
				{ headers },
				env,
			)
		).status,
	).toBe(409);
});
