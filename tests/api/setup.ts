import { applyD1Migrations, env, reset } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeEach, inject } from "vitest";

declare module "vitest" {
	export interface ProvidedContext {
		migrations: D1Migration[];
	}
}
// Reset runtime storage and apply the real migrations for every test.
beforeEach(async () => {
	await reset();
	await applyD1Migrations(env.DB, inject("migrations"));
});
