import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "#/components/shared/empty-state";
export const Route = createFileRoute("/_app/settings")({
	component: () => (
		<>
			<p className="eyebrow">Make it yours</p>
			<h2>Settings</h2>
			<p className="page-description">
				Build a study rhythm that fits your week.
			</p>
			<EmptyState
				title="Your preferences"
				description="Study limits and account settings will appear here."
			/>
		</>
	),
});
