import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { defaultLimits } from "../../src/lib/limits";
import { renderRoute, student } from "./router";

it("routes a new student to welcome, saves edited minutes and never shows welcome again", async () => {
	const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
		async (_url, init) =>
			new Response(init?.body as string, {
				headers: { "content-type": "application/json" },
			}),
	);
	try {
		const { router } = await renderRoute("/", student, Date.now(), null);
		const user = userEvent.setup();
		expect(
			await screen.findByRole("heading", { name: "Welcome to Student Todo" }),
		).toBeVisible();
		for (const day of ["Monday", "Friday"])
			expect(
				screen.getByRole("spinbutton", { name: `${day} (hours)` }),
			).toHaveValue(3);
		expect(
			screen.getByRole("spinbutton", { name: "Saturday (hours)" }),
		).toHaveValue(4);
		const monday = screen.getByRole("spinbutton", { name: "Monday (hours)" });
		await user.clear(monday);
		await user.type(monday, "2");
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(await screen.findByRole("heading", { name: "Today" })).toBeVisible();
		expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).monday).toBe(
			120,
		);
		await router.navigate({ to: "/welcome" });
		expect(router.state.location.pathname).toBe("/");
	} finally {
		fetcher.mockRestore();
	}
});
it("Skip saves the defaults even after editing", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(
			async (_url, init) => new Response(init?.body as string),
		);
	try {
		await renderRoute("/welcome", student, Date.now(), null);
		const user = userEvent.setup();
		await user.clear(
			screen.getByRole("spinbutton", { name: "Monday (hours)" }),
		);
		await user.type(
			screen.getByRole("spinbutton", { name: "Monday (hours)" }),
			"2",
		);
		await user.click(screen.getByRole("button", { name: "Skip" }));
		expect(await screen.findByRole("heading", { name: "Today" })).toBeVisible();
		expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual(
			defaultLimits,
		);
	} finally {
		fetcher.mockRestore();
	}
});
it("shows stored values, prevents invalid saves and persists a weekday edit", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(
			async (_url, init) => new Response(init?.body as string),
		);
	try {
		await renderRoute("/settings", student, Date.now(), {
			...defaultLimits,
			wednesday: 150,
		});
		const user = userEvent.setup();
		expect(
			screen.getByRole("spinbutton", { name: "Wednesday (hours)" }),
		).toHaveValue(2.5);
		const saturday = screen.getByRole("spinbutton", {
			name: "Saturday (hours)",
		});
		await user.clear(saturday);
		await user.type(saturday, "12.5");
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Choose 0–12 hours",
		);
		expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
		await user.clear(saturday);
		await user.type(saturday, "5");
		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).saturday).toBe(
			300,
		);
	} finally {
		fetcher.mockRestore();
	}
});
