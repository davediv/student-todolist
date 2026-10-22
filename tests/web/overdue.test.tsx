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

it.each([
	0, 60,
])("offers re-plan all only for an overdue result shortfall (%s minutes) and Cancel retains that result", async (shortfallMinutes) => {
	let rows = [old];
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url) => {
			if (String(url).endsWith("/replan/overdue")) {
				rows = [];
				return new Response(
					JSON.stringify({
						plans: [
							{
								deadlineId: "a",
								title: "Essay",
								moved: [],
								movedMinutes: 0,
								shortfallMinutes,
							},
						],
					}),
				);
			}
			if (String(url).endsWith("/replan/all/preview"))
				return new Response(
					JSON.stringify({
						plans: [
							{
								deadlineId: "a",
								title: "Essay",
								dueDate: "2026-11-30",
								sessions: [{ date: "2026-10-26", minutes: 60 }],
								keptSessions: [],
								shortfallMinutes: 0,
							},
						],
					}),
				);
			return new Response(
				JSON.stringify(
					String(url).includes("/overdue")
						? { sessions: rows, todos: [] }
						: { days: [], anytime: [] },
				),
			);
		});
	await renderRoute("/", student, Date.now(), defaultLimits, false);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: /^Re-plan$/ }));
	await screen.findByRole("region", { name: "Re-plan result" });
	if (!shortfallMinutes) {
		expect(
			screen.queryByRole("button", { name: "Re-plan all by due date" }),
		).toBeNull();
		return;
	}
	await user.click(
		screen.getByRole("button", { name: "Re-plan all by due date" }),
	);
	expect(await screen.findByRole("heading", { name: "Essay" })).toBeVisible();
	expect(screen.queryByRole("region", { name: "Re-plan result" })).toBeNull();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(
		screen.getByRole("region", { name: "Re-plan result" }),
	).toHaveTextContent("Essay is 1h short");
	const mutations = fetcher.mock.calls.filter(
		([, init]) => init?.method === "POST",
	);
	expect(mutations.map(([url]) => String(url))).toEqual([
		"/api/replan/overdue",
		"/api/replan/all/preview",
	]);
	expect(JSON.parse(mutations[1][1]?.body as string)).toEqual({});
});
