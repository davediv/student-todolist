import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";

type WeeklyStats = InferResponseType<
	typeof apiClient.api.stats.weekly.$get,
	200
>;
export type WeekStats = WeeklyStats["weeks"][number];

export function weeklyStatsQueryOptions(today: string) {
	return queryOptions({
		queryKey: ["stats", "weekly", today],
		queryFn: async () => {
			const response = await apiClient.api.stats.weekly.$get();
			if (response.status === 200) return response.json();
			throw new Error("Could not load weekly progress");
		},
	});
}
