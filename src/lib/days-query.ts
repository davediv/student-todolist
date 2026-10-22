import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";

type DaysResponse = InferResponseType<typeof apiClient.api.days.$get, 200>;
export type PlanDay = DaysResponse["days"][number];
export type DaySession = PlanDay["sessions"][number];

export function daysQueryOptions(from: string, to: string) {
	return queryOptions({
		queryKey: ["days", from, to],
		queryFn: async () => {
			const response = await apiClient.api.days.$get({ query: { from, to } });
			if (response.status === 200) return response.json();
			throw new Error("Could not load your plan");
		},
	});
}
