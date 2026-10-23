import { chromium } from "@playwright/test";
import {
	performanceStudent,
	seedDeadline,
	startPerfServer,
	summarize,
} from "./perf-support";

const server = await startPerfServer(3021);
try {
	const today = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Jakarta",
	}).format(new Date());
	const api = await performanceStudent(server.url, today);
	try {
		await seedDeadline(api, "Performance study plan", 360, today);
		const { cookies } = await api.storageState();
		const browser = await chromium.launch({ headless: true });
		try {
			const samples: number[] = [];
			for (let run = 0; run < 5; run++) {
				const context = await browser.newContext({
					viewport: { width: 390, height: 844 },
					isMobile: true,
					deviceScaleFactor: 1,
					timezoneId: "Asia/Jakarta",
					locale: "en-GB",
					serviceWorkers: "block",
				});
				try {
					await context.addCookies(cookies);
					const page = await context.newPage();

					const cdp = await context.newCDPSession(page);
					await cdp.send("Network.enable");
					await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
					// Chrome/Puppeteer's Fast 4G preset (effective8.1Mbps down,1.35up,165ms).
					await cdp.send("Network.emulateNetworkConditions", {
						offline: false,
						latency: 60 * 2.75,
						downloadThroughput: ((9 * 1_000_000) / 8) * 0.9,
						uploadThroughput: ((1.5 * 1_000_000) / 8) * 0.9,
						connectionType: "cellular4g",
					});
					await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
					await page.goto(server.url, { waitUntil: "commit" });
					// Record visibility in the page on an animation frame. Locator/assertion
					// retry intervals would otherwise inflate the measured result.
					const visibleAt = await page.waitForFunction(
						() => {
							const checkbox = document.querySelector<HTMLInputElement>(
								'input[type="checkbox"][aria-label="Performance study plan, 3h"]',
							);
							return checkbox?.checkVisibility({
								checkOpacity: true,
								checkVisibilityCSS: true,
							})
								? performance.now()
								: false;
						},
						undefined,
						{ polling: "raf", timeout: 15000 },
					);
					samples.push((await visibleAt.jsonValue()) as number);
				} finally {
					await context.close();
				}
			}
			const { median } = summarize(samples);
			console.log(
				JSON.stringify({
					page: "Today list visible",
					viewport: "390x844",
					cpuSlowdown: 4,
					network: "Chrome Fast 4G:8.1Mbps down/1.35Mbps up/165ms",
					cache: "cold HTTP/empty query cache; service workers blocked",
					runs: 5,
					medianMs: Number(median.toFixed(1)),
					targetMs: 2000,
					pass: median < 2000,
					samplesMs: samples.map((value) => Number(value.toFixed(1))),
				}),
			);
			if (median >= 2000) process.exitCode = 1;
		} finally {
			await browser.close();
		}
	} finally {
		await api.dispose();
	}
} finally {
	await server.close();
}
