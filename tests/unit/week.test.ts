import { expect, it } from "vitest";
import { recentWeeks, weekStart } from "../../src/lib/week";

it.each([
	["2026-10-18", "2026-10-12"],
	["2026-10-19", "2026-10-19"],
	["2026-10-23", "2026-10-19"],
	["2027-01-01", "2026-12-28"],
	["2024-03-03", "2024-02-26"],
])("places %s in the Monday-start week %s", (date, monday) => {
	expect(weekStart(date)).toBe(monday);
});

it("returns the current week and three prior Monday–Sunday weeks across a year boundary", () => {
	expect(recentWeeks("2027-01-01")).toEqual([
		{ startDate: "2026-12-28", endDate: "2027-01-03" },
		{ startDate: "2026-12-21", endDate: "2026-12-27" },
		{ startDate: "2026-12-14", endDate: "2026-12-20" },
		{ startDate: "2026-12-07", endDate: "2026-12-13" },
	]);
});
