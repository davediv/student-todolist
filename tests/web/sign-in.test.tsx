import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { authClient } from "../../src/lib/auth-client";
import { renderRoute, student } from "./router";

vi.mock("../../src/lib/auth-client", () => ({
	authClient: { signIn: { social: vi.fn() }, signOut: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
it.each([
	"/",
	"/upcoming",
	"/deadlines",
	"/settings",
])("guards %s without showing navigation", async (path) => {
	const { router } = await renderRoute(path, null);
	expect(
		await screen.findByRole("button", { name: "Sign in with Google" }),
	).toBeVisible();
	expect(router.state.location.pathname).toBe("/sign-in");
	expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
it("redirects a signed-in visitor away from sign-in", async () => {
	const { router } = await renderRoute("/sign-in", student);
	expect(await screen.findByRole("heading", { name: "Today" })).toBeVisible();
	expect(router.state.location.pathname).toBe("/");
});
it.each([
	["not_allowlisted", "This app is invite-only"],
	["access_denied", "Sign-in failed — try again"],
])("shows the Better Auth %s callback error", async (error, message) => {
	await renderRoute(`/sign-in?error=${error}`, null);
	expect(await screen.findByRole("alert")).toHaveTextContent(message);
});
it("starts Google sign-in and remains busy while navigating", async () => {
	vi.mocked(authClient.signIn.social).mockImplementation(
		() => new Promise(() => {}),
	);
	await renderRoute("/sign-in", null);
	await userEvent.click(
		screen.getByRole("button", { name: "Sign in with Google" }),
	);
	expect(authClient.signIn.social).toHaveBeenCalledWith({
		provider: "google",
		callbackURL: "/",
		errorCallbackURL: "/sign-in",
	});
	expect(
		screen.getByRole("button", { name: "Connecting to Google…" }),
	).toBeDisabled();
});
it("shows a retry message for a failed Google request", async () => {
	vi.mocked(authClient.signIn.social).mockRejectedValue(new Error("network"));
	await renderRoute("/sign-in", null);
	await userEvent.click(
		screen.getByRole("button", { name: "Sign in with Google" }),
	);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Sign-in failed — try again",
	);
	expect(
		screen.getByRole("button", { name: "Sign in with Google" }),
	).toBeEnabled();
});
it("shows the account and clears the query cache on sign-out", async () => {
	vi.mocked(authClient.signOut).mockResolvedValue({
		data: { success: true },
		error: null,
	});
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(
			new Response(
				'{"error":{"code":"unauthenticated","message":"Please sign in"}}',
				{ status: 401 },
			),
		);
	try {
		const { router, queryClient } = await renderRoute("/settings");
		queryClient.setQueryData(["private-study-plan"], { secret: true });
		expect(await screen.findByText(student.email)).toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
		expect(
			await screen.findByRole("button", { name: "Sign in with Google" }),
		).toBeVisible();
		expect(router.state.location.pathname).toBe("/sign-in");
		expect(queryClient.getQueryData(["private-study-plan"])).toBeUndefined();
		await router.navigate({ to: "/settings" });
		expect(router.state.location.pathname).toBe("/sign-in");
	} finally {
		fetcher.mockRestore();
	}
});
