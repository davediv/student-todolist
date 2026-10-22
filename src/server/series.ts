import type { Context } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { getDb } from "#/db";
import { series } from "#/db/schema";
import {
	generateOccurrences,
	type PreviewVersion,
	type SeriesInput,
	seriesSchema,
} from "#/lib/series";
import { commitPlan, PlanConflict, planningState } from "./planning-state";
import {
	insertSeriesDeadlines,
	insertSeriesSessions,
	planSeriesOccurrences,
} from "./series-planning";
import type { ApiEnv } from "./types";

type SeriesRequest = SeriesInput & { previewVersion?: PreviewVersion };
async function prepare(c: Context<ApiEnv>) {
	const version = z.object({
		revision: z.number().int().nonnegative(),
		today: z.iso.date(),
	});
	const body = z
		.object({ previewVersion: version.optional() })
		.passthrough()
		.safeParse(await c.req.json().catch(() => null));
	if (!body.success)
		return {
			error: c.json(
				{
					error: {
						code: "validation",
						message: "Check your recurring deadline",
					},
				},
				400,
			),
		};
	const db = getDb(c.env),
		userId = c.get("user").id,
		today = c.get("today");
	const state = await planningState(db, userId);
	if (
		body.data.previewVersion &&
		(body.data.previewVersion.revision !== state.revision ||
			body.data.previewVersion.today !== today)
	)
		throw new PlanConflict();
	const input = seriesSchema(today).safeParse(body.data);
	if (!input.success)
		return {
			error: c.json(
				{
					error: {
						code: "validation",
						message: "Check your recurring deadline",
						fields: input.error.flatten().fieldErrors,
					},
				},
				400,
			),
		};
	const dates = generateOccurrences(today, input.data);
	if (!dates.length)
		return {
			error: c.json(
				{
					error: {
						code: "validation",
						message: "Choose an end date that includes a selected weekday",
						fields: { endDate: ["No occurrences fall before this end date"] },
					},
				},
				400,
			),
		};
	const occurrences = planSeriesOccurrences(
		state,
		dates.map((row) => ({
			...row,
			id: `new:${row.dueDate}`,
			estimateMinutes: input.data.estimateMinutes,
		})),
		today,
	).map(({ id: _id, keptSessions: _kept, ...row }) => row);
	return {
		db,
		userId,
		input: input.data,
		occurrences,
		previewVersion: { revision: state.revision, today },
	};
}

export const seriesRoutes = new Hono<ApiEnv>()
	.post(
		"/series/preview",
		validator("json", (body) => body as SeriesRequest),
		async (c) => {
			const result = await prepare(c);
			if (result.error) return result.error;
			return c.json({
				occurrences: result.occurrences,
				previewVersion: result.previewVersion,
			});
		},
	)
	.post(
		"/series",
		validator("json", (body) => body as SeriesRequest),
		async (c) => {
			const result = await prepare(c);
			if (result.error) return result.error;
			const { db, userId, input, occurrences, previewVersion } = result;
			const savedSeries = {
				...input,
				id: crypto.randomUUID(),
				userId,
				createdAt: new Date(),
			};
			const rows = occurrences.map((row) => ({
				...input,
				id: crypto.randomUUID(),
				userId,
				seriesId: savedSeries.id,
				dueDate: row.dueDate,
				startDate: row.startDate,
				createdAt: savedSeries.createdAt,
			}));
			const sessions = occurrences.flatMap((row, index) =>
				row.sessions.map((session) => ({
					...session,
					id: crypto.randomUUID(),
					userId,
					deadlineId: rows[index].id,
				})),
			);
			await commitPlan(db, userId, previewVersion.revision, [
				db.insert(series).values(savedSeries),
				insertSeriesDeadlines(db, rows),
				insertSeriesSessions(db, sessions),
			]);
			return c.json(
				{
					series: savedSeries,
					occurrences: occurrences.map((row, index) => ({
						...row,
						id: rows[index].id,
					})),
				},
				201,
			);
		},
	);
