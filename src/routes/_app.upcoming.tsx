import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "#/components/shared/empty-state";
export const Route = createFileRoute("/_app/upcoming")({
	component: () => (
		<>
			<p className="eyebrow">One day at a time</p>
			<h2>Upcoming</h2>
			<p className="page-description">
				A little breathing room for the next two weeks.
			</p>
			<EmptyState
				title="Space to plan ahead"
				description="Your upcoming sessions and dated todos will appear here."
			/>
		</>
	),
});
