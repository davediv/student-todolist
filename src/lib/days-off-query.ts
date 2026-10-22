import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import type { DayOffInput } from "./days-off";
import { localDate } from "./format";

export function daysOffQueryOptions() {
	return queryOptions({
		queryKey: ["days-off", localDate()],
		queryFn: async () => await (await apiClient.api["days-off"].$get()).json(),
	});
}
export async function addDayOff(input: DayOffInput) {
	const response = await apiClient.api["days-off"].$post({ json: input });
	if (response.status === 201) return response.json();
	throw new Error("Could not save day off");
}
export async function removeDayOff(id: string) {
	const response = await apiClient.api["days-off"][":id"].$delete({
		param: { id },
	});
	if (response.status === 200) return response.json();
	throw new Error("Could not remove day off");
}
