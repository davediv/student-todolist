import { hc } from "hono/client";
import type { AppType } from "#/server/api";
import { localDate } from "./format";
export class ApiError extends Error {
	constructor(
		public code: string,
		message: string,
		public status: number,
	) {
		super(message);
		this.name = "ApiError";
	}
}
export function createApiClient(
	fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
) {
	return hc<AppType>("/", {
		fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			headers.set("X-Local-Date", localDate());
			const response = await fetcher(input, {
				...init,
				headers,
				credentials: "include",
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: { code: string; message: string };
				} | null;
				throw new ApiError(
					body?.error?.code ?? "request_failed",
					body?.error?.message ?? "Request failed. Please try again.",
					response.status,
				);
			}
			return response;
		},
	});
}
export const apiClient = createApiClient();
