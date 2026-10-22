import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { getDb } from "#/db";
import { todos } from "#/db/schema";
import type { ApiEnv } from "./types";

const titleSchema = z
	.string()
	.trim()
	.min(1, "Enter a title")
	.max(120, "Use at most 120 characters");
const dateSchema = z.iso.date("Enter a valid date").nullable();
const createSchema = z
	.object({ title: titleSchema, date: dateSchema.optional().default(null) })
	.strict();
const editSchema = z
	.object({
		title: titleSchema.optional(),
		date: dateSchema.optional(),
		done: z.boolean().optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, "Choose a change");

export const todosRoutes = new Hono<ApiEnv>()
	.post(
		"/todos",
		validator("json", (body, c) => {
			const parsed = createSchema.safeParse(body);
			if (!parsed.success)
				return c.json(
					{
						error: {
							code: "validation",
							message: "Check your todo",
							fields: parsed.error.flatten().fieldErrors,
						},
					},
					400,
				);
			return parsed.data;
		}),
		async (c) => {
			const input = c.req.valid("json");
			if (input.date && input.date < c.get("today"))
				return c.json(
					{
						error: {
							code: "validation",
							message: "Choose today or a later day",
							fields: { date: ["Choose today or a later day"] },
						},
					},
					400,
				);
			const todo = {
				id: crypto.randomUUID(),
				userId: c.get("user").id,
				...input,
				done: false,
				doneAt: null,
				doneOn: null,
				createdAt: new Date(),
			};
			await getDb(c.env).insert(todos).values(todo);
			return c.json({ todo }, 201);
		},
	)
	.patch(
		"/todos/:id",
		validator("json", (body, c) => {
			const parsed = editSchema.safeParse(body);
			if (!parsed.success)
				return c.json(
					{
						error: {
							code: "validation",
							message: "Check your todo",
							fields: parsed.error.flatten().fieldErrors,
						},
					},
					400,
				);
			return parsed.data;
		}),
		async (c) => {
			const db = getDb(c.env);
			const owner = and(
				eq(todos.id, c.req.param("id")),
				eq(todos.userId, c.get("user").id),
			);
			const todo = await db.query.todos.findFirst({ where: owner });
			if (!todo)
				return c.json(
					{ error: { code: "not_found", message: "Todo not found" } },
					404,
				);
			const input = c.req.valid("json");
			if (input.date && input.date !== todo.date && input.date < c.get("today"))
				return c.json(
					{
						error: {
							code: "validation",
							message: "Choose today or a later day",
							fields: { date: ["Choose today or a later day"] },
						},
					},
					400,
				);
			const update = {
				...input,
				...(input.done === undefined
					? {}
					: {
							doneAt: input.done ? (todo.doneAt ?? new Date()) : null,
							doneOn: input.done ? (todo.doneOn ?? c.get("today")) : null,
						}),
			};
			const [saved] = await db
				.update(todos)
				.set(update)
				.where(owner)
				.returning();
			if (!saved)
				return c.json(
					{ error: { code: "not_found", message: "Todo not found" } },
					404,
				);
			return c.json({ todo: saved });
		},
	)
	.delete("/todos/:id", async (c) => {
		const [deleted] = await getDb(c.env)
			.delete(todos)
			.where(
				and(
					eq(todos.id, c.req.param("id")),
					eq(todos.userId, c.get("user").id),
				),
			)
			.returning({ id: todos.id });
		if (!deleted)
			return c.json(
				{ error: { code: "not_found", message: "Todo not found" } },
				404,
			);
		return c.json({ deleted: deleted.id });
	});
