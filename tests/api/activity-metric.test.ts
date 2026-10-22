import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import metricSql from "../../scripts/activity-metric.sql?raw";
import { apiApp } from "../../src/server/api";
import { signedInHeaders } from "./helpers";

it("counts authenticated local days per student and ISO week across New Year", async () => {
	const headers = await signedInHeaders();
	for (const date of [
		"2020-12-28",
		"2021-01-01",
		"2021-01-03",
		"2021-01-03",
		"2021-01-04",
	]) {
		const response = await apiApp.request(
			"/api/me",
			{ headers: { ...headers, "X-Local-Date": date } },
			env,
		);
		expect(response.status).toBe(200);
	}
	await apiApp.request(
		"/api/me",
		{ headers: await signedInHeaders("friend@example.com", "2021-01-01") },
		env,
	);
	const { results } = await env.DB.prepare(metricSql).all();
	expect(results).toEqual([
		{
			user_id: expect.any(String),
			email: "friend@example.com",
			iso_week: "2020-W53",
			days_used: 1,
			meets_goal: 0,
		},
		{
			user_id: expect.any(String),
			email: "student@example.com",
			iso_week: "2020-W53",
			days_used: 3,
			meets_goal: 1,
		},
		{
			user_id: expect.any(String),
			email: "student@example.com",
			iso_week: "2021-W01",
			days_used: 1,
			meets_goal: 0,
		},
	]);
});
