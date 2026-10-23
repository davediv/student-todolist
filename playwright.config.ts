import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.BROWSER_TEST_PORT ?? 3016);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	workers: 2,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	timeout: 30_000,
	expect: { timeout: 10_000 },
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		timezoneId: "Asia/Jakarta",
		locale: "en-GB",
		serviceWorkers: "block",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: "npm run test:e2e:server",
		url: `${baseURL}/api/health`,
		reuseExistingServer: false,
		gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
		timeout: 120_000,
		env: { BROWSER_TEST_PORT: String(port) },
	},
});
