import { addDeadline, expect, signIn, test } from "./helpers";

test("advance the browser clock, find unfinished work in Overdue, and re-plan it", async ({
	page,
}) => {
	await signIn(page, "overdue@e2e.example", { Tuesday: 0 });
	const title = "History reading";
	await addDeadline(page, { title, hours: 3 });
	await page.getByRole("link", { name: "Today", exact: true }).click();
	await expect(
		page.getByRole("checkbox", { name: `${title}, 3h`, exact: true }),
	).toBeVisible();
	// The application sends the browser's local date to the API. No database edits.
	await page.clock.setFixedTime(new Date("2026-11-03T10:00:00+07:00"));
	await page.reload();
	await expect(page.getByText("Overdue: 1", { exact: true })).toBeVisible();
	await page.getByText("Overdue: 1", { exact: true }).click();
	await expect(
		page
			.locator(".overdue-strip")
			.getByRole("checkbox", { name: `${title}, 3h`, exact: true }),
	).toBeVisible();
	const replanResponse = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/api/replan/overdue" &&
			response.request().method() === "POST",
	);
	await page.getByRole("button", { name: "Re-plan", exact: true }).click();
	const replan = await replanResponse;
	expect(replan.status()).toBe(200);
	const result = (await replan.json()) as {
		plans: {
			movedMinutes: number;
			shortfallMinutes: number;
			moved: { date: string; minutes: number }[];
		}[];
	};
	expect(result.plans).toHaveLength(1);
	expect(result.plans[0].movedMinutes).toBe(180);
	expect(result.plans[0].shortfallMinutes).toBe(0);
	expect(result.plans[0].moved).toEqual([{ date: "2026-11-04", minutes: 180 }]);
	await expect(page.getByText("Overdue: 1", { exact: true })).not.toBeVisible();
	await expect(
		page.getByRole("region", { name: "Re-plan result" }),
	).toContainText("3h moved to your remaining days");
	await page.getByRole("link", { name: "Upcoming", exact: true }).click();
	await expect(
		page
			.getByRole("region", { name: "Wed 4 Nov", exact: true })
			.getByRole("checkbox", { name: `${title}, 3h`, exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "This week 0 / 3h. Show last 4 weeks",
			exact: true,
		}),
	).toBeVisible();
});
