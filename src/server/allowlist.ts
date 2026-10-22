import { APIError } from "better-auth/api";
export function isAllowlisted(email: string, allowed: string) {
	return allowed
		.split(",")
		.some((value) => value.trim().toLowerCase() === email.trim().toLowerCase());
}
export function assertAllowlisted(email: string, allowed: string) {
	if (!isAllowlisted(email, allowed))
		throw new APIError("FORBIDDEN", {
			code: "not_allowlisted",
			message: "This app is invite-only",
		});
}
