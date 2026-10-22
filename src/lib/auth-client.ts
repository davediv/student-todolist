import { createAuthClient } from "better-auth/react";
import { localDate } from "./format";
export const authClient = createAuthClient({
	fetchOptions: {
		credentials: "include",
		onRequest: (context) => {
			context.headers.set("X-Local-Date", localDate());
		},
	},
});
