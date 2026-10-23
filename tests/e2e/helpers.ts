import { test as base, expect, type Page } from "@playwright/test";

export const TODAY = "2026-11-02";
export const test = base.extend<{ browserAudit: undefined }>({
	browserAudit: [
		async ({ page }, use, testInfo) => {
			const errors: string[] = [];
			const requests: { method: string; path: string; status: number }[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") errors.push(message.text());
			});
			page.on("response", (response) => {
				const url = new URL(response.url());
				if (url.pathname.startsWith("/api/"))
					requests.push({
						method: response.request().method(),
						path: url.pathname,
						status: response.status(),
					});
			});
			await use(undefined);
			await testInfo.attach("api-requests", {
				body: JSON.stringify(requests, null, 2),
				contentType: "application/json",
			});
			expect(errors, "Browser JavaScript and console errors").toEqual([]);
		},
		{ auto: true },
	],
});
export { expect };

export async function signIn(
	page: Page,
	email: string,
	limits: Record<string, number> = {},
) {
	await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00+07:00`));
	await page.goto(`/api/test/sign-in?email=${encodeURIComponent(email)}`);
	await expect(
		page.getByRole("heading", { name: "Welcome to Student Todo" }),
	).toBeVisible();
	for (const [day, hours] of Object.entries(limits))
		await page
			.getByLabel(`${day} (hours)`, { exact: true })
			.fill(String(hours));
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Today", exact: true }),
	).toBeVisible();
}

export async function addDeadline(
	page: Page,
	{
		title,
		hours,
		dueDate = "2026-11-06",
		startDate = TODAY,
	}: {
		title: string;
		hours: number;
		dueDate?: string;
		startDate?: string;
	},
) {
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await page.getByRole("menuitem", { name: "Deadline", exact: true }).click();
	await page.getByLabel("Title", { exact: true }).fill(title);
	await page.getByLabel("Due date", { exact: true }).fill(dueDate);
	await page.getByLabel("Start date", { exact: true }).fill(startDate);
	await page.getByLabel("Estimate (hours)").fill(String(hours));
	const previewResponse = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/api/deadlines/preview" &&
			response.request().method() === "POST",
	);
	await page.getByRole("button", { name: "Preview plan", exact: true }).click();
	const preview = await previewResponse;
	expect(preview.status()).toBe(200);
	await expect(
		page.getByRole("heading", { name: "Plan preview", exact: true }),
	).toBeVisible();
	await expect(page.getByText(title, { exact: true })).toBeVisible();
	const plan = (await preview.json()) as {
		sessions: { date: string; minutes: number }[];
		shortfallMinutes: number;
	};
	expect(plan.shortfallMinutes).toBe(0);
	expect(
		plan.sessions.reduce((minutes, session) => minutes + session.minutes, 0),
	).toBe(hours * 60);
	const savedResponse = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/api/deadlines" &&
			response.request().method() === "POST",
	);
	await page.getByRole("button", { name: "Save", exact: true }).click();
	const saved = await savedResponse;
	expect(saved.status()).toBe(201);
	await expect(
		page.getByRole("heading", { name: "Plan preview", exact: true }),
	).not.toBeVisible();
	return plan.sessions;
}
