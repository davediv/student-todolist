import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../src/components/shared/confirm-dialog";
import { Button } from "../../src/components/ui/button";
import { ApiError, createApiClient } from "../../src/lib/api-client";
import { renderRoute } from "./router";

it("navigates between every destination and marks the current page", async () => {
	await renderRoute();
	const user = userEvent.setup();
	for (const label of ["Upcoming", "Deadlines", "Settings", "Today"]) {
		const link = screen.getByRole("link", { name: label });
		await user.click(link);
		expect(await screen.findByRole("heading", { name: label })).toBeVisible();
		expect(link).toHaveAttribute("aria-current", "page");
	}
});
it("sends the device's late-night local date and cookies on every API request", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 14, 23, 30));
	const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
		new Response('{"ok":true}', {
			headers: { "content-type": "application/json" },
		}),
	);
	try {
		await createApiClient(fetcher).api.health.$get();
		const init = fetcher.mock.calls[0][1];
		expect(new Headers(init?.headers).get("X-Local-Date")).toBe("2026-10-14");
		expect(init?.credentials).toBe("include");
	} finally {
		vi.useRealTimers();
	}
});
it("turns API JSON failures into typed errors", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValue(
			new Response(
				'{"error":{"code":"unauthenticated","message":"Please sign in"}}',
				{ status: 401 },
			),
		);
	await expect(createApiClient(fetcher).api.me.$get()).rejects.toMatchObject({
		name: "ApiError",
		code: "unauthenticated",
		status: 401,
	});
	expect(new ApiError("example", "message", 400)).toBeInstanceOf(Error);
});
it("traps confirm-dialog focus, closes on Escape and returns focus", async () => {
	const user = userEvent.setup();
	render(
		<>
			<Button>Outside</Button>
			<ConfirmDialog
				trigger={<Button>Delete</Button>}
				title="Delete item?"
				description="This removes the item."
				onConfirm={() => {}}
			/>
		</>,
	);
	const trigger = screen.getByRole("button", { name: "Delete" });
	await user.click(trigger);
	const cancel = screen.getByRole("button", { name: "Cancel" });
	expect(cancel).toHaveFocus();
	await user.tab({ shift: true });
	expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
	await user.tab();
	expect(cancel).toHaveFocus();
	await user.keyboard("{Escape}");
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	expect(trigger).toHaveFocus();
});
