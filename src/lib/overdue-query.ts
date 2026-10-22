import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import { localDate } from "./format";
export function overdueQueryOptions() {
	return queryOptions({
		queryKey: ["overdue", localDate()],
		queryFn: async () => await (await apiClient.api.overdue.$get()).json(),
	});
}
export async function replanOverdueSessions() {
	return await (await apiClient.api.replan.overdue.$post()).json();
}
