import { expect, it } from "vitest";

it("runs pure logic in Node", () => {
	expect([1, 2].reduce((a, b) => a + b, 0)).toBe(3);
});
