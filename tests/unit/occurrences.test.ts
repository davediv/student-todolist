import { expect, it } from "vitest";
import { generateOccurrences, seriesSchema } from "../../src/lib/series";

it("generates five Fridays from Wednesday with seven lead days", () => {
	const rows = generateOccurrences("2026-10-14", {
		weekdays: [5],
		leadDays: 7,
		endDate: "2026-11-13",
	});
	expect(rows.map((row) => row.dueDate)).toEqual([
		"2026-10-16",
		"2026-10-23",
		"2026-10-30",
		"2026-11-06",
		"2026-11-13",
	]);
	expect(rows[0].startDate).toBe("2026-10-09");
});
it("includes both selected weekdays and skips today", () => {
	expect(
		generateOccurrences("2026-10-13", {
			weekdays: [2, 4],
			leadDays: 2,
			endDate: "2026-10-22",
		}),
	).toEqual([
		{ dueDate: "2026-10-15", startDate: "2026-10-13" },
		{ dueDate: "2026-10-20", startDate: "2026-10-18" },
		{ dueDate: "2026-10-22", startDate: "2026-10-20" },
	]);
});
it.each([
	{},
	{ weekdays: [] },
	{ endDate: "2026-10-14" },
	{ endDate: "2027-10-15" },
	{ leadDays: 0 },
	{ leadDays: 61 },
])("validates a finite weekly schedule: %j", (patch) => {
	const valid = {
		title: "Problem set",
		type: "assignment",
		estimateMinutes: 180,
		weekdays: [5],
		endDate: "2026-11-13",
	};
	if (!Object.keys(patch).length)
		expect(seriesSchema("2026-10-14").parse(valid).leadDays).toBe(7);
	else
		expect(
			seriesSchema("2026-10-14").safeParse({ ...valid, ...patch }).success,
		).toBe(false);
});
