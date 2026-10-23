import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { savedQuery } from "./offline-cache";

type DaysResponse = InferResponseType<typeof apiClient.api.days.$get, 200>;
export type PlanDay = DaysResponse["days"][number];
export type DaySession = PlanDay["sessions"][number];

export function daysQueryOptions(from: string, to: string) {
	return queryOptions({
		queryKey: ["days", from, to],
		staleTime: 30_000,
		queryFn: async () => {
			const response = await apiClient.api.days.$get({ query: { from, to } });
			if (response.status === 200) return response.json();
			throw new Error("Could not load your plan");
		},
	});
}

export function savedDays(client: QueryClient, from: string, to: string) {
	if (from === to) {
		const containing = savedQuery<DaysResponse>(client, ["days"], (data) =>
			data.days.some((day) => day.date === from),
		);
		if (containing)
			return {
				...containing,
				days: containing.days.filter((day) => day.date === from),
			};
	}
	const snapshot = savedQuery<DaysResponse>(
		client,
		["days"],
		(_data, key) => (key[1] === key[2]) === (from === to),
	);
	if (!snapshot) return undefined;
	const relevant = snapshot.days.filter(
		(day) => day.date >= from && day.date <= to,
	);
	return relevant.length ? { ...snapshot, days: relevant } : snapshot;
}
