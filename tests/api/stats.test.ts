import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { deadlines, studySessions } from "../../src/db/schema";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

async function fixture(email = "student@example.com") {
	const headers = await signedInHeaders(email, "2026-10-23");
	const response = await apiApp.request("/api/me", { headers }, env);
	const { id: userId } = (await response.json()) as { id: string };
	const deadlineId = crypto.randomUUID();
	await getDb(env).insert(deadlines).values({
		id: deadlineId,
		userId,
		title: "Weekly essay",
		type: "assignment",
		dueDate: "2026-11-01",
		startDate: "2026-09-01",
		estimateMinutes: 600,
	});
	async function add(date: string, minutes: number, ticked = false) {
		const id = crypto.randomUUID();
		await getDb(env)
			.insert(studySessions)
			.values({
				id,
				userId,
				deadlineId,
				date,
				minutes,
				ticked,
				tickedAt: ticked ? new Date() : null,
			});
		return id;
	}
	return { headers, deadlineId, add };
}

async function stats(headers: Record<string, string>) {
	const response = await apiApp.request("/api/stats/weekly", { headers }, env);
	expect(response.status).toBe(200);
	return (await response.json()) as {
		weeks: {
			startDate: string;
			endDate: string;
			doneMinutes: number;
			plannedMinutes: number;
		}[];
	};
}

it("returns four empty weeks, current first, without requiring study limits", async () => {
	const headers = await signedInHeaders("student@example.com", "2026-10-23");
	expect(await stats(headers)).toEqual({
		weeks: [
			{
				startDate: "2026-10-19",
				endDate: "2026-10-25",
				doneMinutes: 0,
				plannedMinutes: 0,
			},
			{
				startDate: "2026-10-12",
				endDate: "2026-10-18",
				doneMinutes: 0,
				plannedMinutes: 0,
			},
			{
				startDate: "2026-10-05",
				endDate: "2026-10-11",
				doneMinutes: 0,
				plannedMinutes: 0,
			},
			{
				startDate: "2026-09-28",
				endDate: "2026-10-04",
				doneMinutes: 0,
				plannedMinutes: 0,
			},
		],
	});
});

it("sums Monday through Sunday, excluding other students and dates outside four weeks", async () => {
	const own = await fixture();
	await own.add("2026-10-19", 180, true);
	await own.add("2026-10-21", 300);
	await own.add("2026-10-25", 240, true);
	await own.add("2026-10-12", 60, true);
	await own.add("2026-10-18", 120);
	await own.add("2026-09-28", 90, true);
	await own.add("2026-09-27", 600, true);
	await own.add("2026-10-26", 600, true);
	const friend = await fixture("friend@example.com");
	await friend.add("2026-10-19", 720, true);
	expect((await stats(own.headers)).weeks).toEqual([
		{
			startDate: "2026-10-19",
			endDate: "2026-10-25",
			doneMinutes: 420,
			plannedMinutes: 720,
		},
		{
			startDate: "2026-10-12",
			endDate: "2026-10-18",
			doneMinutes: 60,
			plannedMinutes: 180,
		},
		{
			startDate: "2026-10-05",
			endDate: "2026-10-11",
			doneMinutes: 0,
			plannedMinutes: 0,
		},
		{
			startDate: "2026-09-28",
			endDate: "2026-10-04",
			doneMinutes: 90,
			plannedMinutes: 90,
		},
	]);
	expect((await stats(friend.headers)).weeks[0]).toMatchObject({
		doneMinutes: 720,
		plannedMinutes: 720,
	});
});

it("starts a new week on the student's local Monday", async () => {
	const own = await fixture();
	await own.add("2026-10-18", 120, true);
	await own.add("2026-10-19", 180);
	expect(
		(await stats({ ...own.headers, "X-Local-Date": "2026-10-18" })).weeks[0],
	).toMatchObject({
		startDate: "2026-10-12",
		doneMinutes: 120,
		plannedMinutes: 120,
	});
	expect(
		(await stats({ ...own.headers, "X-Local-Date": "2026-10-19" })).weeks.slice(
			0,
			2,
		),
	).toMatchObject([
		{ startDate: "2026-10-19", doneMinutes: 0, plannedMinutes: 180 },
		{ startDate: "2026-10-12", doneMinutes: 120, plannedMinutes: 120 },
	]);
});

it("reflects ticks and unticks immediately without changing planned hours", async () => {
	const own = await fixture();
	const id = await own.add("2026-10-23", 120);
	for (const ticked of [true, false]) {
		const response = await apiApp.request(
			`/api/sessions/${id}`,
			{
				method: "PATCH",
				headers: { ...own.headers, "Content-Type": "application/json" },
				body: JSON.stringify({ ticked }),
			},
			env,
		);
		expect(response.status).toBe(200);
		expect((await stats(own.headers)).weeks[0]).toMatchObject({
			doneMinutes: ticked ? 120 : 0,
			plannedMinutes: 120,
		});
	}
});

it("drops deleted sessions and unticked sessions removed by Mark done, retaining completed work", async () => {
	const own = await fixture();
	const remove = await own.add("2026-10-21", 60);
	await own.add("2026-10-22", 120, true);
	await own.add("2026-10-23", 180);
	expect((await stats(own.headers)).weeks[0]).toMatchObject({
		doneMinutes: 120,
		plannedMinutes: 360,
	});
	expect(
		(
			await apiApp.request(
				`/api/sessions/${remove}`,
				{ method: "DELETE", headers: own.headers },
				env,
			)
		).status,
	).toBe(200);
	expect((await stats(own.headers)).weeks[0]).toMatchObject({
		doneMinutes: 120,
		plannedMinutes: 300,
	});
	expect(
		(
			await apiApp.request(
				`/api/deadlines/${own.deadlineId}/done`,
				{ method: "POST", headers: own.headers },
				env,
			)
		).status,
	).toBe(200);
	expect((await stats(own.headers)).weeks[0]).toMatchObject({
		doneMinutes: 120,
		plannedMinutes: 120,
	});
	expect(
		(
			await apiApp.request(
				`/api/deadlines/${own.deadlineId}`,
				{ method: "DELETE", headers: own.headers },
				env,
			)
		).status,
	).toBe(200);
	expect((await stats(own.headers)).weeks[0]).toMatchObject({
		doneMinutes: 0,
		plannedMinutes: 0,
	});
});

it("requires authentication", async () => {
	expect(
		(
			await apiApp.request(
				"/api/stats/weekly",
				{ headers: { "X-Local-Date": "2026-10-23" } },
				env,
			)
		).status,
	).toBe(401);
});
