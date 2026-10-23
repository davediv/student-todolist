import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { pwa } from "./build/pwa.ts";

const config = defineConfig({
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
	plugins: [
		devtools(),
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		tanstackStart({ spa: { enabled: true } }),
		viteReact(),
		pwa(),
	],
});

export default config;
