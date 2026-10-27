/** Local-only guest account: allowlisted outside production, no Google needed. */
export const guestEmail = "guest@student-todo.test";
export const guestSignInPath = `/api/test/sign-in?email=${encodeURIComponent(guestEmail)}`;
