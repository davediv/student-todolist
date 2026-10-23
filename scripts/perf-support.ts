import { spawn } from "node:child_process";
import { once } from "node:events";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
	type APIRequestContext,
	type APIResponse,
	request,
} from "@playwright/test";

export const fixtureToday = "2026-11-02";
const root = fileURLToPath(new URL("../", import.meta.url));

export async function startPerfServer(defaultPort: number) {
	const port = Number(process.env.BROWSER_TEST_PORT ?? defaultPort);
	if (!Number.isInteger(port) || port < 1024 || port > 65535)
		throw new Error(
			"BROWSER_TEST_PORT must be an integer between 1024 and 65535",
		);
	const busy = await new Promise<boolean>((resolve, reject) => {
		const socket = createConnection({ port, host: "localhost" });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ECONNREFUSED") resolve(false);
			else reject(error);
		});
	});
	if (busy)
		throw new Error(`Port ${port} is in use; choose another BROWSER_TEST_PORT`);
	const url = `http://localhost:${port}`;
	let output = "";
	const server = spawn(
		process.execPath,
		["--import", "tsx", "scripts/browser-test-server.ts"],
		{
			cwd: root,
			env: {
				...process.env,
				BROWSER_TEST_PORT: String(port),
				BROWSER_TEST_MODE: "preview",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	for (const stream of [server.stdout, server.stderr])
		stream.on("data", (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-16_000);
		});
	let startupError: Error | undefined;
	server.on("error", (error) => {
		startupError = error;
	});
	async function close() {
		if (server.exitCode !== null || server.signalCode !== null) return;
		const exited = once(server, "exit");
		server.kill("SIGTERM");
		await exited;
	}
	try {
		const deadline = Date.now() + 120_000;
		while (Date.now() < deadline) {
			if (startupError) throw startupError;
			if (server.exitCode !== null || server.signalCode !== null)
				throw new Error(
					`Isolated performance server exited early.\n${output.slice(-4000)}`,
				);
			const healthy = await fetch(`${url}/api/health`, {
				signal: AbortSignal.timeout(1000),
			})
				.then(
					async (response) =>
						response.ok &&
						((await response.json()) as { ok?: boolean }).ok === true,
				)
				.catch(() => false);
			if (healthy) return { url, close };
			await delay(100);
		}
		throw new Error(
			`Isolated performance server did not become ready.\n${output.slice(-4000)}`,
		);
	} catch (error) {
		await close();
		throw error;
	}
}

export async function checked(response: APIResponse) {
	if (!response.ok())
		throw new Error(
			`${new URL(response.url()).pathname}: HTTP ${response.status()}`,
		);
	return response;
}

export async function performanceStudent(url: string, today = fixtureToday) {
	const api = await request.newContext({
		baseURL: url,
		extraHTTPHeaders: { "X-Local-Date": today },
	});
	try {
		await checked(
			await api.get("/api/test/sign-in?email=performance@e2e.example"),
		);
		const me = await (await checked(await api.get("/api/me"))).json();
		if (me.email !== "performance@e2e.example")
			throw new Error("Unexpected benchmark account");
		await checked(
			await api.put("/api/limits", {
				data: {
					monday: 180,
					tuesday: 180,
					wednesday: 180,
					thursday: 180,
					friday: 180,
					saturday: 180,
					sunday: 180,
				},
			}),
		);
		return api;
	} catch (error) {
		await api.dispose();
		throw error;
	}
}

export async function seedDeadline(
	api: APIRequestContext,
	title: string,
	estimateMinutes: number,
	today = fixtureToday,
) {
	const body = {
		title,
		type: "assignment",
		dueDate: new Date(Date.parse(`${today}T00:00:00Z`) + 28 * 86400000)
			.toISOString()
			.slice(0, 10),
		startDate: today,
		estimateMinutes,
		notes: "Performance fixture",
	};
	const result = await (
		await checked(await api.post("/api/deadlines", { data: body }))
	).json();
	const planned = result.sessions.reduce(
		(sum: number, session: { minutes: number }) => sum + session.minutes,
		0,
	);
	if (planned !== estimateMinutes || result.shortfallMinutes !== 0)
		throw new Error(`Incomplete benchmark fixture: ${title}`);
	return body;
}

export function summarize(samples: number[]) {
	const sorted = [...samples].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return {
		median:
			sorted.length % 2
				? sorted[middle]
				: (sorted[middle - 1] + sorted[middle]) / 2,
		p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
	};
}
