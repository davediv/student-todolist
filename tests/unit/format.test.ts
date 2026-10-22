import { expect, it } from "vitest";
import { formatDate, formatHours, localDate } from "../../src/lib/format";

it("formats minutes as hours", () => {
	expect(formatHours(90)).toBe("1.5h");
	expect(formatHours(120)).toBe("2h");
});
it("formats calendar dates in the requested locale without UTC conversion", () => {
	expect(formatDate("2026-10-14", { dateStyle: "long" }, "en-US")).toBe(
		"October 14, 2026",
	);
	expect(formatDate("2026-10-14", { dateStyle: "long" }, "en-GB")).toBe(
		"14 October 2026",
	);
	expect(localDate(new Date(2026, 9, 14, 23, 30))).toBe("2026-10-14");
});
