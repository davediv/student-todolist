import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { DeadlineForm } from "#/components/deadlines/deadline-form";
import { TypeIcon } from "#/components/deadlines/type-icon";
import { EmptyState } from "#/components/shared/empty-state";
import { Button } from "#/components/ui/button";
import { deadlinesQueryOptions } from "#/lib/deadlines-query";
import { formatDate, formatHours } from "#/lib/format";
export const Route = createFileRoute("/_app/deadlines/")({
	validateSearch: (search: Record<string, unknown>): { add?: boolean } => ({
		add: search.add === true || search.add === "true",
	}),
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(deadlinesQueryOptions),
	component: Deadlines,
});
function Deadlines() {
	const { data: deadlines } = useSuspenseQuery(deadlinesQueryOptions);
	const queryClient = useQueryClient();
	const [adding, setAdding] = useState(!!Route.useSearch().add);
	return (
		<>
			<p className="eyebrow">See the bigger picture</p>
			<div className="page-heading">
				<h2>Deadlines</h2>
				{!adding && <Button onClick={() => setAdding(true)}>+ Deadline</Button>}
			</div>
			<p className="page-description">
				Turn each deadline into manageable days.
			</p>
			{adding ? (
				<DeadlineForm
					onCancel={() => setAdding(false)}
					onSaved={async () => {
						await queryClient.invalidateQueries({
							queryKey: deadlinesQueryOptions.queryKey,
						});
						setAdding(false);
					}}
				/>
			) : deadlines.length ? (
				<ul className="deadline-list">
					{deadlines.map((deadline) => (
						<li key={deadline.id}>
							<Link
								to="/deadlines/$deadlineId"
								params={{ deadlineId: deadline.id }}
								className="deadline-card"
							>
								<div>
									<TypeIcon type={deadline.type} />
									<h3>{deadline.title}</h3>
									<p>Due {formatDate(deadline.dueDate)}</p>
								</div>
								<div className="deadline-progress">
									<strong>
										{deadline.tickedMinutes / 60} /{" "}
										{formatHours(deadline.estimateMinutes)}
									</strong>
									{deadline.unplannedMinutes > 0 && (
										<p className="shortfall">
											{formatHours(deadline.unplannedMinutes)} unplanned
										</p>
									)}
								</div>
							</Link>
						</li>
					))}
				</ul>
			) : (
				<EmptyState
					title="No deadlines yet — add one to get a plan"
					description="A deadline becomes a few manageable study sessions."
				/>
			)}
		</>
	);
}
