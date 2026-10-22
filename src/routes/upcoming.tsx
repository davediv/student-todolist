import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/upcoming")({
	component: () => (
		<main>
			<h1>Upcoming</h1>
		</main>
	),
});
