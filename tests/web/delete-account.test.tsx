import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { renderRoute } from "./router";

afterEach(() => vi.restoreAllMocks());
function mockApi(fail = false) {
	return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
		if (String(url) === "/api/account" && init?.method === "DELETE")
			return new Response(
				fail
					? JSON.stringify({
							error: { code: "internal", message: "Try again" },
						})
					: null,
				{ status: fail ? 500 : 204 },
			);
		if (String(url) === "/api/me") return new Response("{}", { status: 401 });
		return new Response("[]");
	});
}
it("names the data to delete and cancelling leaves the account and cache intact", async () => {
	const fetcher = mockApi();
	const { queryClient } = await renderRoute("/settings");
	const before = queryClient.getQueryData(["deadlines"]);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Delete account" }));
	const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
	expect(dialog).toHaveTextContent(
		/deadlines, study sessions, recurring series, todos, study limits, days off, and days of use/,
	);
	await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
	expect(queryClient.getQueryData(["deadlines"])).toEqual(before);
	expect(
		fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE"),
	).toHaveLength(0);
	expect(screen.getByRole("button", { name: "Delete account" })).toHaveFocus();
});
it("deletes only after confirmation, clears local queries and shows sign-in", async () => {
	const fetcher = mockApi();
	const { queryClient, router } = await renderRoute("/settings");
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Delete account" }));
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	expect(
		await screen.findByRole("button", { name: "Sign in with Google" }),
	).toBeVisible();
	expect(router.state.location.pathname).toBe("/sign-in");
	expect(queryClient.getQueryData(["deadlines"])).toBeUndefined();
	expect(queryClient.getQueryData(["session"])).toBeNull();
	expect(
		fetcher.mock.calls.filter(
			([url, init]) =>
				String(url) === "/api/account" && init?.method === "DELETE",
		),
	).toHaveLength(1);
});
it("keeps the student signed in and allows retry after a failed deletion", async () => {
	mockApi(true);
	const { router, queryClient } = await renderRoute("/settings");
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Delete account" }));
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() =>
		expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong"),
	);
	expect(router.state.location.pathname).toBe("/settings");
	expect(queryClient.getQueryData(["session"])).toBeTruthy();
	expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
});
