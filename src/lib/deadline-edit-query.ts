import { apiClient } from "./api-client";
import type { DeadlineInput } from "./deadlines";

export async function previewDeadlineEdit(id: string, input: DeadlineInput) {
	const response = await apiClient.api.deadlines[":id"].preview.$post({
		param: { id },
		json: input,
	});
	if (response.status === 200) return response.json();
	throw new Error("Could not preview deadline changes");
}

export async function updateDeadline(
	id: string,
	input: DeadlineInput,
	previewVersion?: { revision: number; today: string },
) {
	const response = await apiClient.api.deadlines[":id"].$patch({
		param: { id },
		json: { ...input, previewVersion },
	});
	if (response.status === 200) return response.json();
	throw new Error("Could not save deadline changes");
}
