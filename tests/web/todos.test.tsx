import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localDate } from "../../src/lib/format";
import { defaultLimits } from "../../src/lib/limits";
import { addDays } from "../../src/lib/planner";
import type { Todo } from "../../src/lib/todos-query";
import { renderRoute, student } from "./router";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 26, 12));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function todo(
	id = "one",
	title = "Email professor",
	date: string | null = null,
): Todo {
	return {
		id,
		title,
		date,
		userId: student.id,
		done: false,
		doneAt: null,
		doneOn: null,
		createdAt: new Date().toISOString(),
	};
}
function mockApi(initial: Todo[] = []) {
	let items = [...initial];
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (input, init) => {
			const url = new URL(String(input), "http://localhost");
			const today = localDate();
			const body = init?.body ? JSON.parse(init.body as string) : {};
			const json = (value: unknown, status = 200) =>
				new Response(JSON.stringify(value), { status });
			if (url.pathname === "/api/todos" && init?.method === "POST") {
				const created = todo(String(items.length + 1), body.title, body.date);
				items.push(created);
				return json({ todo: created }, 201);
			}
			if (url.pathname.startsWith("/api/todos/")) {
				const id = url.pathname.split("/").pop();
				if (init?.method === "DELETE") {
					items = items.filter((row) => row.id !== id);
					return json({ deleted: id });
				}
				items = items.map((row) =>
					row.id === id
						? {
								...row,
								...body,
								...(body.done === undefined
									? {}
									: {
											doneOn: body.done ? today : null,
											doneAt: body.done ? new Date().toISOString() : null,
										}),
							}
						: row,
				);
				return json({ todo: items.find((row) => row.id === id) });
			}
			if (url.pathname === "/api/overdue")
				return json({
					sessions: [],
					todos: items.filter(
						(row) => row.date && row.date < today && !row.done,
					),
				});
			if (url.pathname === "/api/days") {
				const from = url.searchParams.get("from") ?? today;
				const to = url.searchParams.get("to") ?? today;
				const visible = items.filter(
					(row) => !row.done || row.doneOn === today,
				);
				const days = [];
				for (let date = from; date <= to; date = addDays(date, 1))
					days.push({
						date,
						plannedMinutes: 0,
						limitMinutes: 180,
						overLimit: false,
						sessions: [],
						todos: visible.filter((row) => row.date === date),
					});
				return json({
					days,
					anytime: visible.filter((row) => row.date === null),
				});
			}
			return json({ pastDue: [], active: [], done: [] });
		});
	return fetcher;
}
function renderPage(path = "/") {
	return renderRoute(path, student, Date.now(), defaultLimits, false);
}
async function openAddTodo(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole("button", { name: "Add" }));
	await user.click(await screen.findByRole("menuitem", { name: "Todo" }));
	return screen.findByRole("dialog", { name: "Add a todo" });
}
it("adds an Anytime todo on Enter and keeps the study hours unchanged", async () => {
	const fetcher = mockApi();
	await renderPage();
	const user = userEvent.setup();
	const sheet = await openAddTodo(user);
	await user.type(
		within(sheet).getByLabelText("Title"),
		"Email professor{Enter}",
	);
	expect(
		await screen.findByRole("checkbox", { name: "Email professor" }),
	).toBeVisible();
	expect(
		within(screen.getByRole("region", { name: "Anytime" })).getByText(
			"Email professor",
		),
	).toBeVisible();
	expect(screen.getByText("0h / 3h")).toBeVisible();
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	const create = fetcher.mock.calls.find(
		([url, init]) => String(url) === "/api/todos" && init?.method === "POST",
	);
	expect(JSON.parse(create?.[1]?.body as string)).toEqual({
		title: "Email professor",
		date: null,
	});
});
it("shows inline errors before save and preserves inputs after a server failure", async () => {
	const fetcher = mockApi();
	await renderPage();
	const user = userEvent.setup();
	await openAddTodo(user);
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(screen.getByText("Enter a title")).toBeVisible();
	expect(screen.getByLabelText("Title")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await user.type(screen.getByLabelText("Title"), "Email professor");
	fetcher.mockImplementationOnce(
		async () =>
			new Response(
				JSON.stringify({ error: { code: "internal", message: "failed" } }),
				{ status: 500 },
			),
	);
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Couldn't save todo — try again",
	);
	expect(screen.getByLabelText("Title")).toHaveValue("Email professor");
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(
		await screen.findByRole("checkbox", { name: "Email professor" }),
	).toBeVisible();
});
it("places a tomorrow todo under its Upcoming day", async () => {
	mockApi();
	await renderPage();
	const user = userEvent.setup();
	await openAddTodo(user);
	await user.type(screen.getByLabelText("Title"), "Buy lab coat");
	fireEvent.change(screen.getByLabelText("Date (optional)"), {
		target: { value: "2026-10-27" },
	});
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	);
	expect(
		screen.queryByRole("checkbox", { name: "Buy lab coat" }),
	).not.toBeInTheDocument();
	await user.click(screen.getByRole("link", { name: "Upcoming" }));
	const tomorrow = await screen.findByRole("region", { name: "Tue 27 Oct" });
	expect(
		within(tomorrow).getByRole("checkbox", { name: "Buy lab coat" }),
	).toBeVisible();
	expect(within(tomorrow).getByText("0h / 3h")).toBeVisible();
	expect(
		screen.queryByText("No study planned in the next 14 days"),
	).not.toBeInTheDocument();
});
it("strikes through ticked Anytime todos and hides them after the local day rolls over", async () => {
	mockApi([todo()]);
	const first = await renderPage();
	const checkbox = await screen.findByRole("checkbox", {
		name: "Email professor",
	});
	await userEvent.setup().click(checkbox);
	await waitFor(() => expect(checkbox).toBeChecked());
	expect(screen.getByText("Email professor")).toHaveStyle({
		textDecoration: "line-through",
	});
	first.unmount();
	vi.setSystemTime(new Date(2026, 9, 27, 1));
	await renderPage();
	expect(
		await screen.findByRole("heading", { name: "Nothing planned today" }),
	).toBeVisible();
	expect(
		screen.queryByRole("checkbox", { name: "Email professor" }),
	).not.toBeInTheDocument();
});
it("re-dates an overdue todo to today and moves it out of the strip", async () => {
	mockApi([todo("one", "Buy lab coat", "2026-10-25")]);
	await renderPage();
	const user = userEvent.setup();
	await user.click(await screen.findByText("Overdue: 1"));
	await user.click(screen.getByRole("button", { name: "Edit Buy lab coat" }));
	expect(
		await screen.findByRole("dialog", { name: "Edit todo" }),
	).toBeVisible();
	fireEvent.change(screen.getByLabelText("Date (optional)"), {
		target: { value: "2026-10-26" },
	});
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(screen.queryByText("Overdue: 1")).not.toBeInTheDocument(),
	);
	expect(
		within(screen.getByRole("region", { name: "Your study plan" })).getByRole(
			"checkbox",
			{ name: "Buy lab coat" },
		),
	).toBeVisible();
});
it("requires confirmation before deleting and preserves the todo when cancelled", async () => {
	const fetcher = mockApi([todo()]);
	await renderPage();
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", { name: "Delete Email professor" }),
	);
	expect(
		await screen.findByRole("dialog", { name: "Delete todo?" }),
	).toBeVisible();
	expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(
		false,
	);
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(
		screen.getByRole("checkbox", { name: "Email professor" }),
	).toBeVisible();
	await user.click(
		screen.getByRole("button", { name: "Delete Email professor" }),
	);
	await user.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() =>
		expect(
			screen.queryByRole("checkbox", { name: "Email professor" }),
		).not.toBeInTheDocument(),
	);
	expect(
		fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE"),
	).toHaveLength(1);
});
