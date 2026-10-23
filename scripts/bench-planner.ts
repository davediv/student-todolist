import { performance } from "node:perf_hooks";
import {
	checked,
	fixtureToday,
	performanceStudent,
	seedDeadline,
	startPerfServer,
	summarize,
} from "./perf-support";

const server = await startPerfServer(3020);
try {
	const api = await performanceStudent(server.url);
	try {
		for (let index = 0; index < 50; index++)
			await seedDeadline(api, `Benchmark deadline ${index + 1}`, 60);
		const groups = await (
			await checked(await api.get("/api/deadlines"))
		).json();
		if (groups.active.length !== 50)
			throw new Error("Expected exactly 50 active benchmark deadlines");
		const pending = {
			title: "Preview benchmark",
			type: "assignment",
			dueDate: "2026-12-15",
			startDate: fixtureToday,
			estimateMinutes: 360,
			notes: "",
		};
		for (const [path, data] of [
			["/api/deadlines/preview", pending],
			["/api/replan/all/preview", {}],
		] as const) {
			const samples: number[] = [];
			for (let index = -1; index < 20; index++) {
				const start = performance.now();
				const result = await (
					await checked(await api.post(path, { data }))
				).json();
				const duration = performance.now() - start;
				if (
					path.includes("replan")
						? result.plans.length !== 50
						: !result.sessions.length
				)
					throw new Error(`Invalid preview response from ${path}`);
				if (index >= 0) samples.push(duration);
			}
			const { median, p95 } = summarize(samples);
			console.log(
				JSON.stringify({
					endpoint: `POST ${path}`,
					activeDeadlines: 50,
					runs: samples.length,
					warmups: 1,
					medianMs: Number(median.toFixed(1)),
					p95Ms: Number(p95.toFixed(1)),
					targetMs: 300,
					pass: p95 < 300,
					samplesMs: samples.map((value) => Number(value.toFixed(1))),
				}),
			);
			if (p95 >= 300) process.exitCode = 1;
		}
	} finally {
		await api.dispose();
	}
} finally {
	await server.close();
}
