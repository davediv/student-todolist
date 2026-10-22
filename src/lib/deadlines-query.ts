import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import type { DeadlineInput } from "./deadlines";
export const deadlinesQueryOptions = queryOptions({
	queryKey: ["deadlines"],
	queryFn: async () => await (await apiClient.api.deadlines.$get()).json(),
});
export function deadlineQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["deadline", id],
		queryFn: async () => {
			const response = await apiClient.api.deadlines[":id"].$get({
				param: { id },
			});
			if (response.status === 200) return response.json();
			throw new Error("Deadline not found");
		},
	});
}
export async function previewDeadline(input: DeadlineInput) {
	const response = await apiClient.api.deadlines.preview.$post({ json: input });
	if (response.status === 200) return response.json();
	throw new Error("Could not preview deadline");
}
export async function createDeadline(input: DeadlineInput) {
	const response = await apiClient.api.deadlines.$post({ json: input });
	if (response.status === 201) return response.json();
	throw new Error("Could not save deadline");
}
export async function markDeadlineDone(id: string) {
	const response = await apiClient.api.deadlines[":id"].done.$post({
		param: { id },
	});
	if (response.status === 200) return response.json();
	throw new Error("Could not mark deadline done");
}
export async function deleteDeadline(id: string) {
	const response = await apiClient.api.deadlines[":id"].$delete({
		param: { id },
	});
	if (response.status === 200) return response.json();
	throw new Error("Could not delete deadline");
}
