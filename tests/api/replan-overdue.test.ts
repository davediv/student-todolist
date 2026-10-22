import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { deadlines, studySessions } from "../../src/db/schema";
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
	const me = (await (
		await apiApp.request("/api/me", { headers }, env)
	).json()) as { id: string };
	const db = getDb(env);
	await db.insert(deadlines).values([
		{
			id: "a",
			userId: me.id,
			title: "Essay",
			type: "assignment",
			startDate: "2026-10-20",
			dueDate: "2026-10-30",
			estimateMinutes: 600,
		},
		{
			id: "b",
			userId: me.id,
			title: "Other",
			type: "reading",
			startDate: "2026-10-20",
			dueDate: "2026-10-31",
			estimateMinutes: 60,
		},
		{
			id: "past",
			userId: me.id,
			title: "Past",
			type: "other",
			startDate: "2026-10-20",
			dueDate: "2026-10-25",
			estimateMinutes: 30,
		},
		{
			id: "done",
			userId: me.id,
			title: "Done",
			type: "other",
			startDate: "2026-10-20",
			dueDate: "2026-10-30",
			estimateMinutes: 30,
			status: "done",
		},
	]);
	await db.insert(studySessions).values([
		{
			id: "old",
			userId: me.id,
			deadlineId: "a",
			date: "2026-10-24",
			minutes: 180,
		},
		{
			id: "future",
			userId: me.id,
			deadlineId: "a",
			date: "2026-10-26",
			minutes: 60,
		},
		{
			id: "ticked",
			userId: me.id,
			deadlineId: "a",
			date: "2026-10-25",
			minutes: 30,
			ticked: true,
		},
		{
			id: "other",
			userId: me.id,
			deadlineId: "b",
			date: "2026-10-26",
			minutes: 60,
		},
		{
			id: "past-old",
			userId: me.id,
			deadlineId: "past",
			date: "2026-10-24",
			minutes: 30,
		},
		{
			id: "done-old",
			userId: me.id,
			deadlineId: "done",
			date: "2026-10-24",
			minutes: 30,
		},
	]);
	return { headers, db };
}
it("excludes ticked, past-due and Done work and isolates students", async () => {
	const { headers } = await setup();
	expect(
		await (await apiApp.request("/api/overdue", { headers }, env)).json(),
	).toMatchObject({ sessions: [{ id: "old" }] });
	expect(
		await (
			await apiApp.request(
				"/api/overdue",
				{ headers: await signedInHeaders("friend@example.com", "2026-10-26") },
				env,
			)
		).json(),
	).toEqual({ sessions: [], todos: [] });
});
it("moves only overdue minutes and merges while preserving future and other rows", async () => {
	const { headers, db } = await setup();
	const before = await db.select().from(studySessions);
	const response = await apiApp.request(
		"/api/replan/overdue",
		{ method: "POST", headers },
		env,
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		plans: [
			{
				deadlineId: "a",
				movedMinutes: 180,
				shortfallMinutes: 0,
				moved: [
					{ date: "2026-10-26", minutes: 60 },
					{ date: "2026-10-27", minutes: 120 },
				],
			},
		],
	});
	const after = await db.select().from(studySessions);
	expect(after.find((row) => row.id === "old")).toBeUndefined();
	expect(after.find((row) => row.id === "future")?.minutes).toBe(120);
	for (const id of ["ticked", "other", "past-old", "done-old"])
		expect(after.find((row) => row.id === id)).toEqual(
			before.find((row) => row.id === id),
		);
	expect(
		await (await apiApp.request("/api/overdue", { headers }, env)).json(),
	).toEqual({ sessions: [], todos: [] });
});
it("reports unplaced hours when limits are zero", async () => {
	const { headers, db } = await setup();
	await apiApp.request(
		"/api/limits",
		{
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(
				Object.fromEntries(Object.keys(defaultLimits).map((day) => [day, 0])),
			),
		},
		env,
	);
	const result = await (
		await apiApp.request(
			"/api/replan/overdue",
			{ method: "POST", headers },
			env,
		)
	).json();
	expect(result).toMatchObject({
		plans: [{ movedMinutes: 0, shortfallMinutes: 180 }],
	});
	expect(
		await db.select().from(studySessions).where(eq(studySessions.id, "old")),
	).toHaveLength(0);
});
