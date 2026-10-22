import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionMenu } from "../../src/components/plan/session-menu";

const session = {
	id: "one",
	deadlineId: "essay",
	title: "Essay",
	date: "2026-10-26",
	minutes: 120,
	ticked: false,
	dueDate: "2026-10-30",
};
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 26, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function setup(value = session) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const invalidate = vi.spyOn(client, "invalidateQueries");
	render(
		<QueryClientProvider client={client}>
			<SessionMenu session={value} />
		</QueryClientProvider>,
	);
	return { user: userEvent.setup(), invalidate };
}
function response(value: unknown = {}) {
	return new Response(JSON.stringify(value));
}
it("opens by click and offers each session action", async () => {
	const { user } = setup();
	await user.click(
		screen.getByRole("button", { name: "Session actions for Essay" }),
	);
	expect(
		await screen.findByRole("menuitem", { name: "Move to day" }),
	).toBeVisible();
	expect(
		screen.getByRole("menuitem", { name: "Change duration" }),
	).toBeVisible();
	expect(screen.getByRole("menuitem", { name: "Delete" })).toBeVisible();
});
it("opens by keyboard, restricts dates, and saves a move with cache refresh", async () => {
	const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
	const { user, invalidate } = setup();
	screen.getByRole("button", { name: "Session actions for Essay" }).focus();
	await user.keyboard("{Enter}{Enter}");
	expect(
		await screen.findByRole("dialog", { name: "Move to day" }),
	).toBeVisible();
	const day = screen.getByLabelText("Day");
	expect(day).toHaveAttribute("min", "2026-10-26");
	expect(day).toHaveAttribute("max", "2026-10-29");
	fireEvent.change(day, { target: { value: "2026-10-28" } });
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	);
	expect(fetcher).toHaveBeenCalledWith(
		"/api/sessions/one",
		expect.objectContaining({
			method: "PATCH",
			body: JSON.stringify({ date: "2026-10-28" }),
		}),
	);
	expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([
		["days"],
		["deadlines"],
		["deadline"],
		["overdue"],
	]);
});
it("sends a resized duration in minutes using half-hour steps", async () => {
	const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
	const { user } = setup();
	await user.click(
		screen.getByRole("button", { name: "Session actions for Essay" }),
	);
	await user.click(
		await screen.findByRole("menuitem", { name: "Change duration" }),
	);
	const duration = await screen.findByLabelText("Duration (hours)");
	expect(duration).toHaveAttribute("min", "0.5");
	expect(duration).toHaveAttribute("max", "12");
	expect(duration).toHaveAttribute("step", "0.5");
	await user.clear(duration);
	await user.type(duration, "1.5");
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(fetcher).toHaveBeenCalledWith(
			"/api/sessions/one",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ minutes: 90 }),
			}),
		),
	);
});
it("keeps an edit open after a failed save and allows retry", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					error: {
						code: "session_ticked",
						message: "That day already has a ticked session",
					},
				}),
				{ status: 409 },
			),
		)
		.mockResolvedValue(response());
	const { user } = setup();
	await user.click(
		screen.getByRole("button", { name: "Session actions for Essay" }),
	);
	await user.click(
		await screen.findByRole("menuitem", { name: "Move to day" }),
	);
	await user.click(await screen.findByRole("button", { name: "Save" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"That day already has a ticked session",
	);
	expect(screen.getByRole("dialog", { name: "Move to day" })).toBeVisible();
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	);
	expect(fetcher).toHaveBeenCalledTimes(2);
});
it("deletes immediately and refreshes the plan", async () => {
	const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
	const { user, invalidate } = setup();
	await user.click(
		screen.getByRole("button", { name: "Session actions for Essay" }),
	);
	await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
	await waitFor(() =>
		expect(fetcher).toHaveBeenCalledWith(
			"/api/sessions/one",
			expect.objectContaining({ method: "DELETE" }),
		),
	);
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	expect(invalidate).toHaveBeenCalledTimes(4);
});
it("hides all editing actions for ticked sessions", () => {
	setup({ ...session, ticked: true });
	expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("disables moving when no dates remain before the due date", async () => {
	const { user } = setup({ ...session, dueDate: "2026-10-26" });
	await user.click(
		screen.getByRole("button", { name: "Session actions for Essay" }),
	);
	expect(
		await screen.findByRole("menuitem", { name: "Move to day" }),
	).toHaveAttribute("aria-disabled", "true");
});
