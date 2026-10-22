import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
	test: {
		projects: [
			{
				resolve: { tsconfigPaths: true },
				test: {
					name: "unit",
					environment: "node",
					include: ["tests/unit/**/*.test.ts"],
				},
			},
			{
				resolve: { tsconfigPaths: true },
				plugins: [react()],
				test: {
					name: "web",
					environment: "jsdom",
					include: ["tests/web/**/*.test.ts?(x)"],
					setupFiles: ["./tests/web/setup.ts"],
				},
			},
			{
				resolve: { tsconfigPaths: true },
				plugins: [
					cloudflareTest({
						main: "./tests/api/worker.ts",
						wrangler: { configPath: "./wrangler.jsonc" },
						miniflare: { compatibilityDate: "2026-08-15" },
					}),
				],
				test: {
					name: "api",
					provide: { migrations: await readD1Migrations("./migrations") },
					include: ["tests/api/**/*.test.ts"],
					setupFiles: ["./tests/api/setup.ts"],
				},
			},
		],
	},
}));
