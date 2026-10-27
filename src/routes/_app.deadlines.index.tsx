import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Repeat2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DeadlineActions } from "#/components/deadlines/deadline-actions";
import { DeadlineForm } from "#/components/deadlines/deadline-form";
import { DeadlineMeter } from "#/components/deadlines/deadline-meter";
import { TypeIcon } from "#/components/deadlines/type-icon";
import { SeriesForm } from "#/components/series/series-form";
import { EmptyState } from "#/components/shared/empty-state";
import { MutationButton } from "#/components/shared/mutation-button";
import { deadlinesQueryOptions } from "#/lib/deadlines-query";
import { formatDate, formatHours } from "#/lib/format";
import { refreshPlan } from "#/lib/plan-cache";
export const Route = createFileRoute("/_app/deadlines/")({
	validateSearch: (
		search: Record<string, unknown>,
	): { add?: boolean; addSeries?: boolean } => ({
		add: search.add === true || search.add === "true",
		addSeries: search.addSeries === true || search.addSeries === "true",
	}),
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(deadlinesQueryOptions),
	component: Deadlines,
});
function Deadlines() {
	const { data: deadlines } = useSuspenseQuery(deadlinesQueryOptions);
	const queryClient = useQueryClient();
	const [adding, setAdding] = useState(!!Route.useSearch().add);
	const [addingSeries, setAddingSeries] = useState(
		!!Route.useSearch().addSeries,
	);
	const addTrigger = useRef<HTMLButtonElement>(null);
	const addSeriesTrigger = useRef<HTMLButtonElement>(null);
	const lastOpened = useRef<"deadline" | "series" | null>(null);
	useEffect(() => {
		if (adding) lastOpened.current = "deadline";
		else if (addingSeries) lastOpened.current = "series";
		else if (lastOpened.current) {
			(lastOpened.current === "series"
				? addSeriesTrigger
				: addTrigger
			).current?.focus();
			lastOpened.current = null;
		}
	}, [adding, addingSeries]);
	function list(items: typeof deadlines.active, pastDue = false) {
		return (
			<ul className="deadline-list">
				{items.map((deadline) => (
					<li key={deadline.id} className="deadline-item sketch">
						<Link
							to="/deadlines/$deadlineId"
							params={{ deadlineId: deadline.id }}
							className="deadline-card"
						>
							<div>
								<span className="deadline-tags">
									<TypeIcon type={deadline.type} />
									{deadline.seriesId && (
										<span className="deadline-type">
											<Repeat2 size={16} aria-hidden="true" />
											<span className="sr-only">Recurring deadline</span>
										</span>
									)}
								</span>
								<h3>{deadline.title}</h3>
								<p
									className={
										pastDue ? "deadline-due is-past-due" : "deadline-due"
									}
								>
									Due {formatDate(deadline.dueDate)}
								</p>
							</div>
							<div className="deadline-progress">
								<strong>
									{deadline.tickedMinutes / 60} /{" "}
									{formatHours(deadline.estimateMinutes)}
								</strong>
								<DeadlineMeter
									tickedMinutes={deadline.tickedMinutes}
									estimateMinutes={deadline.estimateMinutes}
								/>
								{deadline.status === "active" &&
									deadline.unplannedMinutes > 0 && (
										<p className="shortfall">
											{formatHours(deadline.unplannedMinutes)} unplanned
										</p>
									)}
							</div>
						</Link>
						<DeadlineActions deadline={deadline} />
					</li>
				))}
			</ul>
		);
	}
	return (
		<>
			<p className="eyebrow">See the bigger picture</p>
			<div className="page-heading">
				<h2 className="page-title">Deadlines</h2>
				{!adding && !addingSeries && (
					<div className="page-actions">
						<MutationButton ref={addTrigger} onClick={() => setAdding(true)}>
							+ Deadline
						</MutationButton>
						<MutationButton
							ref={addSeriesTrigger}
							variant="outline"
							onClick={() => setAddingSeries(true)}
						>
							+ Recurring
						</MutationButton>
					</div>
				)}
			</div>
			<p className="page-description">
				Turn each deadline into manageable days.
			</p>
			{addingSeries ? (
				<SeriesForm
					onCancel={() => setAddingSeries(false)}
					onSaved={async () => {
						await refreshPlan(queryClient);
						setAddingSeries(false);
					}}
				/>
			) : adding ? (
				<DeadlineForm
					onCancel={() => setAdding(false)}
					onSaved={async () => {
						await refreshPlan(queryClient);
						setAdding(false);
					}}
				/>
			) : deadlines.pastDue.length +
				deadlines.active.length +
				deadlines.done.length ? (
				<>
					{deadlines.pastDue.length > 0 && (
						<section className="deadline-group" aria-label="Past due">
							<h3 className="group-label is-past-due">Past due</h3>
							{list(deadlines.pastDue, true)}
						</section>
					)}
					<section className="deadline-group" aria-label="Active">
						<h3 className="group-label">Active</h3>
						{deadlines.active.length ? (
							list(deadlines.active)
						) : (
							<p className="day-empty">No active deadlines.</p>
						)}
					</section>
					{deadlines.done.length > 0 && (
						<details className="done-deadlines deadline-group">
							<summary>Done ({deadlines.done.length})</summary>
							{list(deadlines.done)}
						</details>
					)}
				</>
			) : (
				<EmptyState
					title="No deadlines yet — add one to get a plan"
					description="A deadline becomes a few manageable study sessions."
				/>
			)}
		</>
	);
}
