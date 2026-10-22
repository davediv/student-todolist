import type { AuthUser } from "#/lib/auth";
export type ApiEnv = {
	Bindings: Env;
	Variables: { user: AuthUser; today: string };
};
