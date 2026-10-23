import AxeBuilder from "@axe-core/playwright";
import {
	expect,
	type Locator,
	type Page,
	test,
	type TestInfo,
} from "@playwright/test";

const today = "2026-11-02";
const email = "accessibility@e2e.example";

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date(`${today}T10:00:00+07:00`));
});
test.afterEach(async ({ page }) => {
	await page.context().setOffline(false);
	const response = await page.request.delete("/api/account", {
		headers: { "X-Local-Date": today },
	});
	expect([204, 401]).toContain(response.status());
});

async function scan(page: Page, info: TestInfo, name: string) {
	const result = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.options({ rules: { "target-size": { enabled: true } } })
		.analyze();
	await info.attach(`${name}-axe`, {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
	await info.attach(`${name}-tree`, {
		body: await page.locator("body").ariaSnapshot(),
		contentType: "text/yaml",
	});
	await info.attach(`${name}-screen`, {
		body: await page.screenshot({ fullPage: true }),
		contentType: "image/png",
	});
	expect(
		result.violations,
		`${name}: ${JSON.stringify(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })))}`,
	).toEqual([]);
	// The product's 24px minimum also applies where axe allows a spacing exception.
	for (const control of await page
		.locator("button, a[href], input, select, textarea, summary")
		.all()) {
		if (!(await control.isVisible())) continue;
		const box = await control.boundingBox();
		const label =
			(await control.getAttribute("aria-label")) ??
			(await control.textContent());
		expect(box?.width, `${label}: touch width`).toBeGreaterThanOrEqual(24);
		expect(box?.height, `${label}: touch height`).toBeGreaterThanOrEqual(24);
	}
}

async function setUpStudent(page: Page) {
	await page.goto(`/api/test/sign-in?email=${email}`);
	await expect(
		page.getByRole("heading", { name: "Welcome to Student Todo" }),
	).toBeVisible();
}

async function seedDeadline(
	page: Page,
	title: string,
	dueDate: string,
	estimateMinutes: number,
) {
	const response = await page.request.post("/api/deadlines", {
		headers: { "X-Local-Date": today },
		data: {
			title,
			type: "assignment",
			dueDate,
			startDate: today,
			estimateMinutes,
			notes: "Accessibility fixture",
		},
	});
	expect(response.status()).toBe(201);
	return response.json() as Promise<{ deadline: { id: string } }>;
}

for (const colorScheme of ["light", "dark"] as const) {
	test(`all screens and states in ${colorScheme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			// Anonymous sign-in correctly receives a 401 from /api/me.
			if (
				message.type() === "error" &&
				!message.text().includes("401 (Unauthorized)")
			)
				errors.push(message.text());
		});
		await page.emulateMedia({ colorScheme });
		await page.goto("/sign-in");
		await expect(
			page.getByRole("button", { name: "Sign in with Google" }),
		).toBeVisible();
		await scan(page, info, "sign-in");
		await setUpStudent(page);
		await scan(page, info, "welcome");
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(
			page.getByRole("heading", { name: "Today", exact: true }),
		).toBeVisible();
		await seedDeadline(page, "Overdue study", "2026-11-10", 180);
		await seedDeadline(page, "Past due essay", "2026-11-03", 60);
		const completed = await seedDeadline(
			page,
			"Completed reading",
			"2026-11-12",
			60,
		);
		const done = await page.request.post(
			`/api/deadlines/${completed.deadline.id}/done`,
			{ headers: { "X-Local-Date": today } },
		);
		expect(done.status()).toBe(200);
		await page.clock.setFixedTime(new Date("2026-11-04T10:00:00+07:00"));
		const active = await page.request.post("/api/deadlines", {
			headers: { "X-Local-Date": "2026-11-04" },
			data: {
				title: "Current study",
				type: "reading",
				startDate: "2026-11-04",
				dueDate: "2026-11-12",
				estimateMinutes: 180,
				notes: "",
			},
		});
		expect(active.status()).toBe(201);
		const dayOff = await page.request.post("/api/days-off", {
			headers: { "X-Local-Date": "2026-11-04" },
			data: { date: "2026-11-04", limitMinutes: 0 },
		});
		expect(dayOff.status()).toBe(201);
		await page.goto("/");
		await page.getByText(/^Overdue: /).click();
		await expect(page.getByText("Over limit", { exact: false })).toBeVisible();
		await scan(page, info, "today-overdue-over-limit");
		await page.getByRole("link", { name: "Upcoming", exact: true }).click();
		await expect(
			page.getByRole("button", { name: /Show last 4 weeks/ }),
		).toBeVisible();
		await scan(page, info, "upcoming");
		await page.getByRole("button", { name: /Show last 4 weeks/ }).click();
		await scan(page, info, "four-week-dialog");
		await page.keyboard.press("Escape");
		await page.getByRole("link", { name: "Deadlines", exact: true }).click();
		await page.getByText(/^Done \(/).click();
		await expect(
			page.getByRole("region", { name: "Past due", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("region", { name: "Active", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: /Completed reading/ }),
		).toBeVisible();
		await scan(page, info, "deadline-groups");
		await page.getByRole("link", { name: /Current study/ }).click();
		await expect(
			page.getByRole("heading", { name: "Current study", exact: true }),
		).toBeVisible();
		await scan(page, info, "deadline-detail");
		await page.getByRole("link", { name: "← Deadlines", exact: true }).click();
		await page.getByRole("button", { name: "+ Deadline", exact: true }).click();
		await scan(page, info, "deadline-form");
		await page.getByLabel("Title", { exact: true }).fill("Accessible essay");
		await page.getByLabel("Due date", { exact: true }).fill("2026-11-10");
		await page.getByLabel("Start date", { exact: true }).fill("2026-11-04");
		await page.getByLabel("Estimate (hours)").fill("2");
		await page
			.getByRole("button", { name: "Preview plan", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Plan preview", exact: true }),
		).toBeVisible();
		await scan(page, info, "deadline-preview");
		await page.goto("/deadlines?addSeries=true");
		await expect(
			page.getByRole("heading", {
				name: "Add a recurring deadline",
				exact: true,
			}),
		).toBeVisible();
		await scan(page, info, "recurring-form");
		await page.getByRole("link", { name: "Settings", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Delete account", exact: true }),
		).toBeVisible();
		await scan(page, info, "settings");
		await page
			.getByRole("button", { name: "Delete account", exact: true })
			.click();
		await expect(
			page.getByRole("dialog", { name: "Delete your account?" }),
		).toBeVisible();
		await scan(page, info, "account-confirm");
		await page.keyboard.press("Escape");
		await page.getByRole("link", { name: "Today", exact: true }).click();
		await expect(
			page.getByRole("checkbox", { name: "Current study, 3h" }),
		).toBeVisible();
		await page.context().setOffline(true);
		await expect(
			page.getByRole("status").filter({ hasText: "You're offline" }),
		).toBeVisible();
		await scan(page, info, "offline");
		expect(errors, "Browser console and JavaScript errors").toEqual([]);
	});
}

async function visibleFocus(target: Locator) {
	await expect(target).toBeFocused();
	expect(
		await target.evaluate((element) => {
			const style = getComputedStyle(element);
			return (
				(style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
				style.boxShadow !== "none"
			);
		}),
		"Keyboard focus must have a visible outline or ring",
	).toBe(true);
}
async function tabTo(page: Page, target: Locator) {
	for (let count = 0; count < 60; count++) {
		if (
			await target.evaluate((element) => element === document.activeElement)
		) {
			await visibleFocus(target);
			return;
		}
		await page.keyboard.press("Tab");
	}
	throw new Error(
		`Could not reach ${(await target.getAttribute("aria-label")) ?? (await target.textContent())} using Tab`,
	);
}

test("keyboard-only sign-in, deadline preview/save, tick, and session menu", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await setUpStudent(page);
	await tabTo(page, page.getByRole("button", { name: "Save", exact: true }));
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("heading", { name: "Today", exact: true }),
	).toBeVisible();
	await tabTo(page, page.getByRole("button", { name: "Add", exact: true }));
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("menuitem", { name: "Deadline", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await tabTo(page, page.getByLabel("Title", { exact: true }));
	await page.keyboard.type("Keyboard essay");
	await tabTo(page, page.getByLabel("Due date", { exact: true }));
	await page.keyboard.type("06");
	await page.keyboard.type("11");
	await page.keyboard.type("2026");
	await expect(page.getByLabel("Due date", { exact: true })).toHaveValue(
		"2026-11-06",
	);
	await tabTo(page, page.getByLabel("Start date", { exact: true }));
	await page.keyboard.type("02");
	await page.keyboard.type("11");
	await page.keyboard.type("2026");
	await tabTo(page, page.getByLabel("Estimate (hours)"));
	await page.keyboard.type("2");
	await tabTo(
		page,
		page.getByRole("button", { name: "Preview plan", exact: true }),
	);
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("heading", { name: "Plan preview", exact: true }),
	).toBeVisible();
	await visibleFocus(
		page.getByRole("heading", { name: "Plan preview", exact: true }),
	);
	await tabTo(page, page.getByRole("button", { name: "Save", exact: true }));
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("heading", { name: "Plan preview", exact: true }),
	).not.toBeVisible();
	await visibleFocus(
		page.getByRole("button", { name: "+ Deadline", exact: true }),
	);
	await tabTo(page, page.getByRole("link", { name: "Today", exact: true }));
	await page.keyboard.press("Enter");
	const checkbox = page.getByRole("checkbox", {
		name: "Keyboard essay, 2h",
		exact: true,
	});
	await tabTo(page, checkbox);
	await page.keyboard.press("Space");
	await expect(checkbox).toBeChecked();
	await expect(checkbox).toBeEnabled();
	await visibleFocus(checkbox);
	await page.keyboard.press("Space");
	await expect(checkbox).not.toBeChecked();
	await expect(checkbox).toBeEnabled();
	const actions = page.getByRole("button", {
		name: "Session actions for Keyboard essay",
	});
	await tabTo(page, actions);
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("menuitem", { name: "Move to day", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await visibleFocus(actions);
	await page.keyboard.press("Tab");
	await expect(actions).not.toBeFocused();
	await info.attach("keyboard-finish", {
		body: await page.screenshot({ fullPage: true }),
		contentType: "image/png",
	});
	expect(errors).toEqual([]);
});
