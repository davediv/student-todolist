import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiClient } from "./api-client";
export const sessionQueryOptions = queryOptions({
	queryKey: ["session"],
	staleTime: 30_000,
	retry: false,
	queryFn: async () => {
		try {
			return await (await apiClient.api.me.$get()).json();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) return null;
			throw error;
		}
	},
});
