import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { pwa } from "./build/pwa.ts";

if (
	!process.env.BROWSER_TEST_CONFIG_PATH ||
	!process.env.BROWSER_TEST_STATE_PATH
)
	throw new Error("Start this config through npm run test:e2e:server");

export default defineConfig({
	resolve: { tsconfigPaths: true },
	server: {
		watch: {
			ignored: [
				"**/playwright-report/**",
				"**/test-results/**",
				"**/blob-report/**",
				"**/.wrangler/browser-tests/**",
			],
		},
	},
	cacheDir: process.env.BROWSER_TEST_CACHE_PATH,
	plugins: [
		cloudflare({
			configPath: process.env.BROWSER_TEST_CONFIG_PATH,
			persistState: { path: process.env.BROWSER_TEST_STATE_PATH },
			viteEnvironment: { name: "ssr" },
			inspectorPort: false,
		}),
		tailwindcss(),
		tanstackStart({ spa: { enabled: true } }),
		viteReact(),
		pwa(),
	],
});
