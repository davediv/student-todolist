import { defineConfig } from "@playwright/test";

const port = Number(process.env.BROWSER_TEST_PORT ?? 3022);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
	testDir: "./tests/a11y",
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 10_000 },
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL,
		browserName: "chromium",
		viewport: { width: 390, height: 844 },
		timezoneId: "Asia/Jakarta",
		locale: "en-GB",
		serviceWorkers: "block",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "npm run test:e2e:server",
		url: `${baseURL}/api/health`,
		reuseExistingServer: false,
		gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
		timeout: 120_000,
		env: { BROWSER_TEST_PORT: String(port), BROWSER_TEST_MODE: "preview" },
	},
});
