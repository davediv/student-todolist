import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { assertAllowlisted } from "#/server/allowlist";

export function testSignInPlugin(allowedEmails: string) {
	return {
		id: "local-test-sign-in",
		endpoints: {
			testSignIn: createAuthEndpoint(
				"/test-sign-in",
				{ method: "GET", query: z.object({ email: z.email() }) },
				async (ctx) => {
					const email = ctx.query.email.trim().toLowerCase();
					assertAllowlisted(email, allowedEmails);
					const existing =
						await ctx.context.internalAdapter.findUserByEmail(email);
					const user =
						existing?.user ??
						(await ctx.context.internalAdapter.createUser(
							{
								email,
								name: email.split("@")[0],
								emailVerified: true,
							},
							{ method: "local-test" },
						));
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					if (!session)
						throw new APIError("INTERNAL_SERVER_ERROR", {
							message: "Could not create session",
						});
					await setSessionCookie(ctx, { session, user });
					throw ctx.redirect("/");
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
