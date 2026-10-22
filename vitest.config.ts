import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
				test: { name: "api", include: ["tests/api/**/*.test.ts"] },
			},
		],
	},
});
