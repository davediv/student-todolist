import { addDeadline, expect, signIn, TODAY, test } from "./helpers";

test("add a deadline, review its preview, then see sessions on Today and Upcoming", async ({
	page,
}) => {
	await signIn(page, "add-deadline@e2e.example");
	const title = "Biology essay";
	const sessions = await addDeadline(page, { title, hours: 6 });
	expect(sessions).toEqual([
		{ date: TODAY, minutes: 180 },
		{ date: "2026-11-03", minutes: 180 },
	]);
	await page.getByRole("link", { name: "Today", exact: true }).click();
	await expect(
		page.getByRole("checkbox", { name: `${title}, 3h`, exact: true }),
	).toBeVisible();
	await page.getByRole("link", { name: "Upcoming", exact: true }).click();
	const tomorrow = page.getByRole("region", { name: "Tue 3 Nov", exact: true });
	await expect(
		tomorrow.getByRole("checkbox", { name: `${title}, 3h`, exact: true }),
	).toBeVisible();
});
