import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { getDb } from "#/db";
import * as schema from "#/db/schema";
import { guestEmail } from "#/lib/guest";
import { assertAllowlisted } from "#/server/allowlist";
import { testSignInPlugin } from "#/server/test-sign-in";

export function getAuth(env: Env) {
	const db = getDb(env);
	const production = env.ENVIRONMENT === "production";
	const allowedEmails = production
		? env.ALLOWED_EMAILS
		: `${env.ALLOWED_EMAILS},${guestEmail}`;
	return betterAuth({
		appName: "Student Todo",
		baseURL: env.BETTER_AUTH_URL,
		basePath: "/api/auth",
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema,
			transaction: false,
		}),
		emailAndPassword: { enabled: false },
		disabledPaths: ["/sign-up/email", "/sign-in/email"],
		socialProviders: {
			google: {
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET,
			},
		},
		onAPIError: { errorURL: `${env.BETTER_AUTH_URL}/sign-in` },
		advanced: {
			useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
			defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						assertAllowlisted(user.email, allowedEmails);
					},
				},
			},
			session: {
				create: {
					before: async (session) => {
						const student = await db.query.user.findFirst({
							where: eq(schema.user.id, session.userId),
						});
						assertAllowlisted(student?.email ?? "", allowedEmails);
					},
				},
			},
		},
		plugins: production ? [] : [testSignInPlugin(allowedEmails)],
	});
}
export type AuthUser = ReturnType<typeof getAuth>["$Infer"]["Session"]["user"];
