import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderRoute } from "./router";

it("renders the root route with a fresh query client", async () => {
	await renderRoute();
	expect(
		await screen.findByRole("heading", { name: "Student Todo" }),
	).toBeVisible();
});
