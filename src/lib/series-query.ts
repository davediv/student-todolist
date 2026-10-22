import { apiClient } from "./api-client";
import type { SeriesInput } from "./series";

export async function previewSeries(input: SeriesInput) {
	const response = await apiClient.api.series.preview.$post({ json: input });
	if (response.status === 200) return response.json();
	throw new Error("Could not preview recurring deadline");
}

export async function createSeries(
	input: SeriesInput,
	previewVersion: { revision: number; today: string },
) {
	const response = await apiClient.api.series.$post({
		json: { ...input, previewVersion },
	});
	if (response.status === 201) return response.json();
	throw new Error("Could not create recurring deadline");
}
