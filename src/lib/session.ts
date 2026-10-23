import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiClient } from "./api-client";
import { adoptSession, clearOfflineData } from "./offline-cache";
export const sessionQueryOptions = queryOptions({
	queryKey: ["session"],
	staleTime: 30_000,
	retry: false,
	queryFn: async ({ client }) => {
		try {
			const user = await (await apiClient.api.me.$get()).json();
			adoptSession(client, user);
			return user;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				clearOfflineData(client);
				return null;
			}
			throw error;
		}
	},
});
