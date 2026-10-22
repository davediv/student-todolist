import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { defaultLimits } from "../../src/lib/limits";
import { renderRoute, student } from "./router";

afterEach(() => vi.restoreAllMocks());
const old = {
	id: "old",
	deadlineId: "a",
	userId: student.id,
	title: "Essay",
	type: "assignment",
	dueDate: "2026-11-30",
	date: "2026-10-20",
	minutes: 120,
	ticked: false,
	tickedAt: null,
};
it("expands overdue work and ticking removes it from the count", async () => {
	let rows = [old];
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url) => {
			if (String(url).includes("/sessions/")) {
				rows = [];
				return new Response('{"session":{}}');
			}
			return new Response(
				JSON.stringify(
					String(url).includes("/overdue") ? { sessions: rows } : { days: [] },
				),
			);
		});
	await renderRoute("/", student, Date.now(), defaultLimits, false);
	const user = userEvent.setup();
	await user.click(await screen.findByText("Overdue: 1"));
	await user.click(screen.getByRole("checkbox", { name: "Essay, 2h" }));
	await waitFor(() =>
		expect(screen.queryByText("Overdue: 1")).not.toBeInTheDocument(),
	);
	expect(
		fetcher.mock.calls.find(([url]) => String(url).includes("/sessions/"))?.[1]
			?.method,
	).toBe("PATCH");
});
it("re-plans then reports moved hours and per-deadline shortfall", async () => {
	let rows = [old];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
		if (String(url).includes("/replan/overdue") && init?.method === "POST") {
			rows = [];
			return new Response(
				JSON.stringify({
					plans: [
						{
							deadlineId: "a",
							title: "Essay",
							moved: [{ date: "2026-10-26", minutes: 60 }],
							movedMinutes: 60,
							shortfallMinutes: 60,
						},
					],
				}),
			);
		}
		return new Response(
			JSON.stringify(
				String(url).includes("/overdue") ? { sessions: rows } : { days: [] },
			),
		);
	});
	await renderRoute("/", student, Date.now(), defaultLimits, false);
	await userEvent.click(
		await screen.findByRole("button", { name: /^Re-plan$/ }),
	);
	expect(
		await screen.findByText("1h moved to your remaining days"),
	).toBeVisible();
	expect(screen.getByText("Essay is 1h short")).toBeVisible();
	expect(screen.queryByText("Overdue: 1")).not.toBeInTheDocument();
});
it("does not show a strip when nothing is overdue", async () => {
	await renderRoute();
	expect(screen.queryByText(/Overdue:/)).not.toBeInTheDocument();
});
