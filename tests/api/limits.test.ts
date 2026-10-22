import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "../../src/db";
import { studyLimits, user } from "../../src/db/schema";
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
