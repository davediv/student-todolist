import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { studyLimits, studySessions, user } from "../../src/db/schema";
import { defaultLimits } from "../../src/lib/limits";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

it("stores all weekdays, persists updates and isolates students", async () => {
	const headers = await signedInHeaders();
	expect(
		await (await apiApp.request("/api/limits", { headers }, env)).json(),
	).toBeNull();
	const put = await apiApp.request(
		"/api/limits",
		{
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(defaultLimits),
		},
		env,
	);
	expect(put.status).toBe(200);
	expect(await put.json()).toEqual(defaultLimits);
	const changed = { ...defaultLimits, wednesday: 150 };
	await apiApp.request(
		"/api/limits",
		{
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(changed),
		},
		env,
	);
	expect(
		await (await apiApp.request("/api/limits", { headers }, env)).json(),
	).toEqual(changed);
	expect(
		await (
			await apiApp.request(
				"/api/limits",
				{ headers: await signedInHeaders("friend@example.com") },
				env,
			)
		).json(),
	).toBeNull();
	const [student] = await getDb(env)
		.select()
		.from(user)
		.where(eq(user.email, "student@example.com"));
	await getDb(env).delete(user).where(eq(user.id, student.id));
	expect(await getDb(env).select().from(studyLimits)).toHaveLength(0);
});

it("keeps every session in place when a weekday limit is lowered and flags over-limit days", async () => {
	const headers = await signedInHeaders("student@example.com", "2026-10-25");
	const saveLimits = (monday: number) =>
		apiApp.request(
			"/api/limits",
			{
				method: "PUT",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify({ ...defaultLimits, monday }),
			},
			env,
		);
	expect((await saveLimits(180)).status).toBe(200);
	const created = await apiApp.request(
		"/api/deadlines",
		{
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Monday study",
				type: "assignment",
				dueDate: "2026-10-28",
				startDate: "2026-10-26",
				estimateMinutes: 300,
				notes: "",
			}),
		},
		env,
	);
	expect(created.status).toBe(201);
	const before = await getDb(env)
		.select()
		.from(studySessions)
		.orderBy(studySessions.id);
	expect(before).toHaveLength(2);
	expect((await saveLimits(60)).status).toBe(200);
	expect(
		await getDb(env).select().from(studySessions).orderBy(studySessions.id),
	).toEqual(before);
	const response = await apiApp.request(
		"/api/days?from=2026-10-26&to=2026-11-08",
		{ headers },
		env,
	);
	expect(response.status).toBe(200);
	const result = (await response.json()) as {
		days: {
			date: string;
			limitMinutes: number;
			plannedMinutes: number;
			overLimit: boolean;
			sessions: { id: string; date: string; minutes: number }[];
		}[];
	};
	expect(result.days).toHaveLength(14);
	expect(result.days[0]).toMatchObject({
		date: "2026-10-26",
		limitMinutes: 60,
		plannedMinutes: 180,
		overLimit: true,
	});
	expect(result.days[1]).toMatchObject({
		date: "2026-10-27",
		plannedMinutes: 120,
		overLimit: false,
	});
	expect(
		result.days.flatMap((day) =>
			day.sessions.map(({ id, date, minutes }) => ({ id, date, minutes })),
		),
	).toEqual(
		[...before]
			.sort((a, b) => a.date.localeCompare(b.date))
			.map(({ id, date, minutes }) => ({ id, date, minutes })),
	);
});
it.each([
	-30,
	750,
	31,
	null,
	undefined,
])("rejects invalid and missing weekdays (%s) with field errors", async (monday) => {
	const headers = await signedInHeaders();
	const response = await apiApp.request(
		"/api/limits",
		{
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ ...defaultLimits, monday }),
		},
		env,
	);
	expect(response.status).toBe(400);
	expect(await response.json()).toMatchObject({
		error: { code: "validation", fields: { monday: expect.any(Array) } },
	});
	expect(await getDb(env).select().from(studyLimits)).toHaveLength(0);
});
