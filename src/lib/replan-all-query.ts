import { apiClient } from "./api-client";
import type { DeadlineInput } from "./deadlines";

export type ReplanAllRequest = {
	pending?: { id?: string; input: DeadlineInput };
};

export async function previewReplanAll(input: ReplanAllRequest = {}) {
	const response = await apiClient.api.replan.all.preview.$post({
		json: input,
	});
	if (response.status === 200) return response.json();
	throw new Error("Could not preview the new plan");
}

export async function saveReplanAll(input: ReplanAllRequest = {}) {
	const response = await apiClient.api.replan.all.$post({ json: input });
	if (response.status === 200) return response.json();
	throw new Error("Could not save the new plan");
}
