import { and, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import { getDb } from "#/db";
import { deadlines, series, studySessions } from "#/db/schema";
import { addDays } from "#/lib/planner";
import { generateOccurrences } from "#/lib/series";
import { type SeriesScopeInput, seriesScopeSchema } from "#/lib/series-scope";
import { commitPlan, PlanConflict, planningState } from "./planning-state";
import {
	insertSeriesDeadlines,
	insertSeriesSessions,
	planSeriesOccurrences,
} from "./series-planning";
import type { ApiEnv } from "./types";

async function loadScope(c: Context<ApiEnv>) {
	const db = getDb(c.env),
		userId = c.get("user").id;
	const seriesId = c.req.param("seriesId") ?? "";
	const where = and(eq(series.id, seriesId), eq(series.userId, userId));
	const owned = await db.query.series.findFirst({ where });
	const notFound = () => ({
		error: c.json(
			{ error: { code: "not_found", message: "Series occurrence not found" } },
			404,
		),
	});
	if (!owned) return notFound();
	const state = await planningState(db, userId);
	// Read the template after the revision so every relevant change is guarded.
	const template = await db.query.series.findFirst({ where });
	const anchor = state.deadlines.find(
		(row) => row.id === c.req.param("id") && row.seriesId === seriesId,
	);
	if (!template || !anchor) return notFound();
	const all = state.deadlines.filter((row) => row.seriesId === seriesId);
	return { error: undefined, db, userId, state, template, anchor, all, where };
}

async function prepare(c: Context<ApiEnv>) {
	const context = await loadScope(c);
	if (context.error) return context;
	const { state, template, anchor, all } = context;
	const parsed = seriesScopeSchema(c.get("today"), template.endDate).safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success)
		return {
			error: c.json(
				{
					error: {
						code: "validation",
						message: "Check your series changes",
						fields: parsed.error.flatten().fieldErrors,
					},
				},
				400,
			),
		};
	const { previewVersion, ...changes } = parsed.data;
	if (
		previewVersion &&
		(previewVersion.revision !== state.revision ||
			previewVersion.today !== c.get("today"))
	)
		throw new PlanConflict();
	const updatedTemplate = { ...template, ...changes };
	const following = all.filter(
		(row) => row.status === "active" && row.dueDate >= anchor.dueDate,
	);
	const removed = following.filter(
		(row) => row.dueDate > updatedTemplate.endDate,
	);
	const retained = following
		.filter((row) => row.dueDate <= updatedTemplate.endDate)
		.map((row) => ({
			...row,
			...(changes.title !== undefined ? { title: changes.title } : {}),
			...(changes.type !== undefined ? { type: changes.type } : {}),
			...(changes.notes !== undefined ? { notes: changes.notes } : {}),
			...(changes.estimateMinutes !== undefined
				? { estimateMinutes: changes.estimateMinutes }
				: {}),
			...(changes.leadDays !== undefined
				? { startDate: addDays(row.dueDate, -changes.leadDays) }
				: {}),
		}));
	const occupied = new Set(all.map((row) => row.dueDate));
	const first = [c.get("today"), template.endDate, addDays(anchor.dueDate, -1)]
		.sort()
		.at(-1) as string;
	const added =
		updatedTemplate.endDate > template.endDate
			? generateOccurrences(first, updatedTemplate)
					.filter((row) => !occupied.has(row.dueDate))
					.map((row) => ({
						id: `new:${row.dueDate}`,
						userId: context.userId,
						seriesId: template.id,
						title: updatedTemplate.title,
						type: updatedTemplate.type,
						notes: updatedTemplate.notes,
						estimateMinutes: updatedTemplate.estimateMinutes,
						...row,
						status: "active" as const,
						doneAt: null,
						createdAt: new Date(),
					}))
			: [];
	// Removed occurrences free their capacity; all their rows are removed on Save.
	const removedIds = new Set(removed.map((row) => row.id));
	const rows = [...retained, ...added];
	const plans = planSeriesOccurrences(
		{
			...state,
			sessions: state.sessions.filter((row) => !removedIds.has(row.deadlineId)),
		},
		rows,
		c.get("today"),
	);
	const occurrences = plans.map((plan) => {
		const row = rows.find((row) => row.id === plan.id);
		if (!row) throw new Error("Occurrence missing from plan");
		return {
			...plan,
			title: row.title,
			type: row.type,
			notes: row.notes,
			estimateMinutes: row.estimateMinutes,
			action: (plan.id.startsWith("new:") ? "create" : "update") as
				| "create"
				| "update",
		};
	});
	return {
		...context,
		changes,
		updatedTemplate,
		rows,
		occurrences,
		removed: removed.map(({ id, title, dueDate }) => ({ id, title, dueDate })),
		previewVersion: { revision: state.revision, today: c.get("today") },
	};
}
const idsFromJson = (ids: string[]) =>
	sql`(select value from json_each(${JSON.stringify(ids)}))`;

export const seriesScopeRoutes = new Hono<ApiEnv>()
	.get("/series/:id", async (c) => {
		const row = await getDb(c.env).query.series.findFirst({
			where: and(
				eq(series.id, c.req.param("id")),
				eq(series.userId, c.get("user").id),
			),
		});
		if (!row)
			return c.json(
				{ error: { code: "not_found", message: "Series not found" } },
				404,
			);
		return c.json({ series: row });
	})
	.post(
		"/series/:seriesId/occurrences/:id/preview",
		validator("json", (body) => body as SeriesScopeInput),
		async (c) => {
			const result = await prepare(c);
			if (result.error) return result.error;
			return c.json({
				occurrences: result.occurrences,
				removed: result.removed,
				previewVersion: result.previewVersion,
			});
		},
	)
	.patch(
		"/series/:seriesId/occurrences/:id",
		validator("json", (body) => body as SeriesScopeInput),
		async (c) => {
			const result = await prepare(c);
			if (result.error) return result.error;
			const { db, userId, state, where, changes, rows, removed, occurrences } =
				result;
			const updates = rows.filter((row) => !row.id.startsWith("new:"));
			const additions = rows
				.filter((row) => row.id.startsWith("new:"))
				.map((row) => ({ ...row, id: crypto.randomUUID() }));
			const newId = new Map(additions.map((row) => [row.dueDate, row.id]));
			const sessions = occurrences.flatMap((row) =>
				row.sessions.map((session) => ({
					...session,
					id: crypto.randomUUID(),
					userId,
					deadlineId: newId.get(row.dueDate) ?? row.id,
				})),
			);
			const queries: Parameters<typeof commitPlan>[3] = [];
			if (Object.keys(changes).length)
				queries.push(db.update(series).set(changes).where(where));
			if (removed.length)
				queries.push(
					db
						.delete(deadlines)
						.where(
							and(
								eq(deadlines.userId, userId),
								sql`${deadlines.id} in ${idsFromJson(removed.map((row) => row.id))}`,
							),
						),
				);
			if (updates.length) {
				queries.push(
					db
						.update(deadlines)
						.set({
							title: sql`json_extract(changes.value,'$.title')`,
							type: sql`json_extract(changes.value,'$.type')`,
							notes: sql`json_extract(changes.value,'$.notes')`,
							estimateMinutes: sql`json_extract(changes.value,'$.estimateMinutes')`,
							startDate: sql`json_extract(changes.value,'$.startDate')`,
						})
						.from(sql`json_each(${JSON.stringify(updates)}) as changes`)
						.where(
							and(
								eq(deadlines.userId, userId),
								sql`${deadlines.id}=json_extract(changes.value,'$.id')`,
							),
						),
				);
				queries.push(
					db
						.delete(studySessions)
						.where(
							and(
								eq(studySessions.userId, userId),
								eq(studySessions.ticked, false),
								sql`${studySessions.deadlineId} in ${idsFromJson(updates.map((row) => row.id))}`,
							),
						),
				);
			}
			if (additions.length) queries.push(insertSeriesDeadlines(db, additions));
			if (sessions.length) queries.push(insertSeriesSessions(db, sessions));
			if (queries.length) await commitPlan(db, userId, state.revision, queries);
			return c.json({
				occurrences: occurrences.map((row) => ({
					...row,
					id: newId.get(row.dueDate) ?? row.id,
				})),
				removed,
			});
		},
	)
	.delete("/series/:seriesId/occurrences/:id", async (c) => {
		const context = await loadScope(c);
		if (context.error) return context.error;
		const { db, userId, state, template, anchor, all, where } = context;
		const ids = all
			.filter((row) => row.status === "active" && row.dueDate >= anchor.dueDate)
			.map((row) => row.id);
		await commitPlan(db, userId, state.revision, [
			db
				.update(series)
				.set({
					endDate:
						template.endDate < anchor.dueDate
							? template.endDate
							: addDays(anchor.dueDate, -1),
				})
				.where(where),
			db
				.delete(deadlines)
				.where(
					and(
						eq(deadlines.userId, userId),
						sql`${deadlines.id} in ${idsFromJson(ids)}`,
					),
				),
		]);
		return c.json({ deleted: ids });
	});
