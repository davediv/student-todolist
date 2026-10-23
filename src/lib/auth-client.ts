import { createAuthClient } from "better-auth/react";
import { ApiError } from "./api-client";
import { localDate } from "./format";
import { isOnline, offlineHint } from "./offline";
export const authClient = createAuthClient({
	fetchOptions: {
		credentials: "include",
		onRequest: (context) => {
			if (!isOnline()) throw new ApiError("offline", offlineHint, 0);
			context.headers.set("X-Local-Date", localDate());
		},
	},
});
