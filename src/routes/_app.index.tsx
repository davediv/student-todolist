import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "#/components/shared/empty-state";
export const Route = createFileRoute("/_app/")({ component: Today });
function Today() {
	return (
		<>
			<p className="eyebrow">A little progress, every day</p>
			<h2>Today</h2>
			<p className="page-description">Make room for what matters.</p>
			<EmptyState
				title="A clear day ahead"
				description="Your study sessions and todos will appear here."
			/>
		</>
	);
}
