import type { QueryClient } from "@tanstack/react-query";
export async function refreshPlan(client: QueryClient) {
	await Promise.all(
		["days", "deadlines", "deadline", "overdue"].map((key) =>
			client.invalidateQueries({ queryKey: [key] }),
		),
	);
}
