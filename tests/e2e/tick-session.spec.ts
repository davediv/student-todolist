import { addDeadline, expect, signIn, test } from "./helpers";

test("tick a session and count its hours on the deadline and weekly card", async ({
	page,
}) => {
	await signIn(page, "tick-session@e2e.example");
	const title = "Chemistry revision";
	await addDeadline(page, { title, hours: 6 });
	await page.getByRole("link", { name: "Today", exact: true }).click();
	const checkbox = page.getByRole("checkbox", {
		name: `${title}, 3h`,
		exact: true,
	});
	const tickResponse = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname.startsWith("/api/sessions/") &&
			response.request().method() === "PATCH",
	);
	// The controlled checkbox updates after its mutation and cache refresh.
	await checkbox.click();
	expect((await tickResponse).status()).toBe(200);
	await expect(checkbox).toBeChecked();
	await page.getByRole("link", { name: title, exact: true }).click();
	await expect(page.getByText(/Due .* · 3 \/ 6h/)).toBeVisible();
	await page.getByRole("link", { name: "Upcoming", exact: true }).click();
	await expect(
		page.getByRole("button", {
			name: "This week 3 / 6h. Show last 4 weeks",
			exact: true,
		}),
	).toBeVisible();
	await expect(
		page.getByRole("progressbar", { name: "This week's study hours" }),
	).toHaveAttribute("aria-valuenow", "3");
});
