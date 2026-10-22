import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import type { StudyLimits } from "./limits";
export const limitsQueryOptions = queryOptions({
	queryKey: ["limits"],
	staleTime: 30_000,
	queryFn: async () => await (await apiClient.api.limits.$get()).json(),
});
export async function saveLimits(values: StudyLimits) {
	const response = await apiClient.api.limits.$put({ json: values });
	if (response.status === 200) return response.json();
	throw new Error("Could not save limits");
}
