import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import type { PreviewVersion } from "./series";
import type { SeriesScopeInput } from "./series-scope";

export function seriesQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["series", id],
		refetchOnMount: "always",
		queryFn: async () => {
			const response = await apiClient.api.series[":id"].$get({
				param: { id },
			});
			if (response.status === 200) return response.json();
			throw new Error("Recurring deadline not found");
		},
	});
}
export async function previewSeriesScope(
	seriesId: string,
	id: string,
	input: SeriesScopeInput,
) {
	const response = await apiClient.api.series[":seriesId"].occurrences[
		":id"
	].preview.$post({ param: { seriesId, id }, json: input });
	if (response.status === 200) return response.json();
	throw new Error("Could not preview recurring deadline changes");
}
export async function saveSeriesScope(
	seriesId: string,
	id: string,
	input: SeriesScopeInput,
	previewVersion: PreviewVersion,
) {
	const response = await apiClient.api.series[":seriesId"].occurrences[
		":id"
	].$patch({ param: { seriesId, id }, json: { ...input, previewVersion } });
	if (response.status === 200) return response.json();
	throw new Error("Could not save recurring deadline changes");
}
export async function deleteSeriesFollowing(seriesId: string, id: string) {
	const response = await apiClient.api.series[":seriesId"].occurrences[
		":id"
	].$delete({ param: { seriesId, id } });
	if (response.status === 200) return response.json();
	throw new Error("Could not delete recurring deadlines");
}
