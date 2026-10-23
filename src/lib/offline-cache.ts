import {
	onlineManager,
	type QueryClient,
	type QueryKey,
} from "@tanstack/react-query";
import {
	type PersistedClient,
	type Persister,
	persistQueryClientRestore,
	persistQueryClientSubscribe,
} from "@tanstack/react-query-persist-client";
import { ApiError, apiClient } from "./api-client";
import { isOnline } from "./offline";

export const offlineCacheKey = "student-todo-plan-v1";
export const offlineCacheMaxAge = 14 * 24 * 60 * 60 * 1000;
const planKeys = new Set([
	"session",
	"limits",
	"days",
	"overdue",
	"deadlines",
	"deadline",
	"stats",
	"days-off",
	"series",
]);
const ready = new WeakMap<QueryClient, Promise<void>>();
const retryRestore = new WeakSet<QueryClient>();

export function waitForOfflineCache(client: QueryClient) {
	return (
		ready.get(client) ??
		(retryRestore.has(client) ? prepareOfflineCache(client) : Promise.resolve())
	);
}

/** Read a successful saved snapshot without creating a misleading current-date key. */
export function savedQuery<T>(
	client: QueryClient,
	prefix: QueryKey,
	accept: (data: T, key: QueryKey) => boolean = () => true,
) {
	const queries = client
		.getQueryCache()
		.findAll({ queryKey: prefix })
		.filter(
			(query) =>
				query.state.data !== undefined &&
				accept(query.state.data as T, query.queryKey),
		)
		.sort(
			(left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt,
		);
	return queries[0]?.state.data as T | undefined;
}

function removeStoredPlan() {
	try {
		localStorage.removeItem(offlineCacheKey);
	} catch {
		/* Storage can be unavailable. */
	}
}

export function clearOfflineData(client: QueryClient) {
	// Keep the session query itself alive so a 401 can finish its route guard.
	client.removeQueries({
		predicate: (query) => query.queryKey[0] !== "session",
	});
	client.getMutationCache().clear();
	client.setQueryData(["session"], null);
	removeStoredPlan();
}

export function adoptSession(client: QueryClient, current: { id: string }) {
	const previous = client.getQueryData<{ id: string } | null>(["session"]);
	if (previous?.id && previous.id !== current.id) {
		client.removeQueries({
			predicate: (query) => query.queryKey[0] !== "session",
		});
		removeStoredPlan();
	}
}

/** Verify the cookie before any restored user's plan is allowed to render online. */
export async function reconcileSession(client: QueryClient) {
	if (!isOnline()) return;
	try {
		const current = await (await apiClient.api.me.$get()).json();
		adoptSession(client, current);
		client.setQueryData(["session"], current);
	} catch (error) {
		if (!(error instanceof ApiError) || error.status !== 401) throw error;
		clearOfflineData(client);
	}
}

export function prepareOfflineCache(client: QueryClient) {
	if (typeof window === "undefined") return Promise.resolve();
	const existing = ready.get(client);
	if (existing) return existing;
	const persister: Persister = {
		persistClient: (value) => {
			try {
				if (client.getQueryData(["session"])) {
					localStorage.setItem(offlineCacheKey, JSON.stringify(value));
				} else removeStoredPlan();
			} catch {
				/* The app remains usable when device storage is full. */
			}
		},
		restoreClient: () => {
			try {
				const value = localStorage.getItem(offlineCacheKey);
				if (!value) return undefined;
				const saved = JSON.parse(value) as PersistedClient;
				const session = saved.clientState.queries.find(
					(query) => query.queryKey[0] === "session",
				)?.state.data as {
					id?: unknown;
					name?: unknown;
					email?: unknown;
				} | null;
				if (
					!session ||
					typeof session.id !== "string" ||
					typeof session.name !== "string" ||
					typeof session.email !== "string"
				) {
					removeStoredPlan();
					return undefined;
				}
				saved.clientState.queries = saved.clientState.queries.filter((query) =>
					planKeys.has(String(query.queryKey[0])),
				);
				saved.clientState.mutations = [];
				return saved;
			} catch {
				removeStoredPlan();
				return undefined;
			}
		},
		removeClient: removeStoredPlan,
	};
	const restore = (async () => {
		onlineManager.setOnline(isOnline());
		await persistQueryClientRestore({
			queryClient: client,
			persister,
			buster: "plan-v1",
			maxAge: offlineCacheMaxAge,
		});
		await reconcileSession(client);
		persistQueryClientSubscribe({
			queryClient: client,
			persister,
			buster: "plan-v1",
			dehydrateOptions: {
				shouldDehydrateMutation: () => false,
				shouldDehydrateQuery: (query) =>
					query.state.data !== undefined &&
					planKeys.has(String(query.queryKey[0])),
			},
		});
		retryRestore.delete(client);
	})().catch((error) => {
		// A transient startup failure must be retryable on reconnect or Retry.
		ready.delete(client);
		retryRestore.add(client);
		throw error;
	});
	ready.set(client, restore);
	return restore;
}
