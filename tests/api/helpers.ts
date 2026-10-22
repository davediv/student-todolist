import { env } from "cloudflare:test";
import { apiApp } from "../../src/server/api";
export async function signedInHeaders(
	email = "student@example.com",
	today = "2026-10-22",
) {
	const response = await apiApp.request(
		`/api/test/sign-in?email=${encodeURIComponent(email)}`,
		{},
		env,
	);
	if (response.status !== 302) throw new Error("Test sign-in failed");
	return {
		cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
		"X-Local-Date": today,
	};
}
