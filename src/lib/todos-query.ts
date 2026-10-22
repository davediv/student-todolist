import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";

export type Todo = InferResponseType<
	(typeof apiClient.api.todos)[":id"]["$patch"],
	200
>["todo"];
export type TodoInput = { title: string; date: string | null };
export async function createTodo(input: TodoInput) {
	const response = await apiClient.api.todos.$post({ json: input });
	if (response.status === 201) return response.json();
	throw new Error("Couldn't add todo — try again");
}
export async function updateTodo(
	id: string,
	input: Partial<TodoInput> & { done?: boolean },
) {
	const response = await apiClient.api.todos[":id"].$patch({
		param: { id },
		json: input,
	});
	if (response.status === 200) return response.json();
	throw new Error("Couldn't update todo — try again");
}
export async function deleteTodo(id: string) {
	const response = await apiClient.api.todos[":id"].$delete({ param: { id } });
	if (response.status === 200) return response.json();
	throw new Error("Couldn't delete todo — try again");
}
