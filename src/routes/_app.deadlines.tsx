import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "#/components/shared/empty-state";
export const Route = createFileRoute("/_app/deadlines")({
	component: () => (
		<>
			<p className="eyebrow">See the bigger picture</p>
			<h2>Deadlines</h2>
			<p className="page-description">
				Turn each deadline into manageable days.
			</p>
			<EmptyState
				title="Start with a deadline"
				description="Your coursework and its study plans will live here."
			/>
		</>
	),
});
