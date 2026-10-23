import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.BROWSER_TEST_PORT ?? 3016);
const mode = process.env.BROWSER_TEST_MODE ?? "dev";
if (!Number.isInteger(port) || port < 1024 || port > 65535)
	throw new Error(
		"BROWSER_TEST_PORT must be an integer between 1024 and 65535",
	);
if (mode !== "dev" && mode !== "preview")
	throw new Error("BROWSER_TEST_MODE must be dev or preview");
const stateRoot = resolve(root, ".wrangler/browser-tests");
await mkdir(stateRoot, { recursive: true });
const state = await mkdtemp(resolve(stateRoot, "run-"));
// Closing workerd can exhaust the event loop before async cleanup resumes.
process.once("exit", () => rmSync(state, { recursive: true, force: true }));
const configPath = resolve(state, "wrangler.json");
const persistPath = resolve(state, "state");
const variables = {
	ENVIRONMENT: "test",
	BETTER_AUTH_URL: `http://localhost:${port}`,
	BETTER_AUTH_SECRET: "isolated-browser-tests-only-not-a-production-secret-32",
	GOOGLE_CLIENT_ID: "browser-test-placeholder",
	GOOGLE_CLIENT_SECRET: "browser-test-placeholder",
	ALLOWED_EMAILS:
		process.env.BROWSER_TEST_EMAILS ??
		"add-deadline@e2e.example,tick-session@e2e.example,overdue@e2e.example,account-validation@e2e.example,manual@e2e.example,performance@e2e.example,accessibility@e2e.example",
};
const database = {
	binding: "DB",
	database_name: "student-browser-test",
	database_id: "11111111-1111-4111-8111-111111111111",
	migrations_dir: resolve(root, "migrations"),
};
await writeFile(
	configPath,
	JSON.stringify({
		name: "student-todolist-browser-test",
		main: fileURLToPath(
			import.meta.resolve("@tanstack/react-start/server-entry"),
		),
		compatibility_date: "2026-10-19",
		compatibility_flags: ["nodejs_compat"],
		vars: variables,
		d1_databases: [database],
	}),
);
process.env.CLOUDFLARE_ENV = "";
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
process.env.BROWSER_TEST_CONFIG_PATH = configPath;
process.env.BROWSER_TEST_STATE_PATH = persistPath;
process.env.BROWSER_TEST_CACHE_PATH = resolve(state, "vite-cache");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
function runWrangler(args: string[]) {
	return spawn(process.execPath, [wrangler, ...args], {
		cwd: state,
		env: process.env,
		stdio: ["ignore", "inherit", "inherit"],
	});
}

try {
	await new Promise<void>((resolveMigration, reject) => {
		const migration = runWrangler([
			"d1",
			"migrations",
			"apply",
			"DB",
			"--local",
			"--persist-to",
			persistPath,
			"--config",
			configPath,
		]);
		migration.on("error", reject);
		migration.on("exit", (code) =>
			code === 0
				? resolveMigration()
				: reject(new Error(`Browser-test migrations exited ${code}`)),
		);
	});
	const { createBuilder, createServer } = await import("vite");
	const viteOptions = {
		root,
		configFile: resolve(root, "vite.browser-test.config.ts"),
	};
	let close: () => Promise<void>;
	if (mode === "preview") {
		const deployPath = resolve(root, ".wrangler/deploy/config.json");
		const previousDeploy = await readFile(deployPath).catch(
			(error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
				return null;
			},
		);
		const output = resolve(state, "dist");
		try {
			const builder = await createBuilder({
				...viteOptions,
				build: { outDir: output },
			});
			await builder.buildApp();
		} finally {
			// The Cloudflare build writes this shared redirect even with isolated output.
			if (previousDeploy) await writeFile(deployPath, previousDeploy);
			else await rm(deployPath, { force: true });
		}
		const builtConfigPath = resolve(output, "server/wrangler.json");
		const builtConfig = JSON.parse(await readFile(builtConfigPath, "utf8"));
		builtConfig.vars = variables;
		builtConfig.d1_databases = [database];
		delete builtConfig.env;
		await writeFile(builtConfigPath, JSON.stringify(builtConfig));
		const runtime = runWrangler([
			"dev",
			"--local",
			"--config",
			builtConfigPath,
			"--persist-to",
			persistPath,
			"--port",
			String(port),
			"--ip",
			"localhost",
			"--inspector-port",
			"0",
			"--show-interactive-dev-session=false",
		]);
		runtime.on("error", (error) => {
			throw error;
		});
		runtime.on("exit", (code) => process.exit(code ?? 1));
		close = async () => {
			await new Promise<void>((resolveClose) => {
				runtime.once("exit", () => resolveClose());
				runtime.kill("SIGTERM");
			});
		};
	} else {
		const server = await createServer({
			...viteOptions,
			server: { port, host: "localhost", strictPort: true },
		});
		await server.listen();
		close = () => server.close();
		console.log(`Isolated browser-test server: http://localhost:${port}`);
	}
	let stopping = false;
	async function stop() {
		if (stopping) return;
		stopping = true;
		await close();
		await rm(state, { recursive: true, force: true });
		process.exit(0);
	}
	process.once("SIGTERM", () => void stop());
	process.once("SIGINT", () => void stop());
} catch (error) {
	await rm(state, { recursive: true, force: true });
	throw error;
}
