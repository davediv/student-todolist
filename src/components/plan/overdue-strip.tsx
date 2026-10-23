import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MutationButton } from "#/components/shared/mutation-button";
import { TodoRow } from "#/components/todos/todo-row";
import { Button } from "#/components/ui/button";
import { formatHours } from "#/lib/format";
import {
	overdueQueryOptions,
	replanOverdueSessions,
} from "#/lib/overdue-query";
import { refreshPlan } from "#/lib/plan-cache";
import { ReplanAllPreview } from "./replan-all-preview";
import { SessionRow } from "./session-row";
export function OverdueStrip() {
	const query = useQuery(overdueQueryOptions());
	const client = useQueryClient();
	const [showAll, setShowAll] = useState(false);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const [result, setResult] = useState<Awaited<
		ReturnType<typeof replanOverdueSessions>
	> | null>(null);
	async function replan() {
		setBusy(true);
		setError("");
		try {
			setResult(await replanOverdueSessions());
			await refreshPlan(client);
		} catch {
			setError("Couldn't re-plan — try again");
		} finally {
			setBusy(false);
		}
	}
	if (showAll)
		return (
			<ReplanAllPreview
				onCancel={() => setShowAll(false)}
				onSaved={async () => {
					await refreshPlan(client);
					setResult(null);
					setShowAll(false);
				}}
			/>
		);
	if (query.isError)
		return (
			<div className="plan-error">
				<p>Couldn't load overdue work</p>
				<Button variant="outline" onClick={() => void query.refetch()}>
					Retry overdue
				</Button>
			</div>
		);
	const sessions = query.data?.sessions ?? [];
	const todos = query.data?.todos ?? [];
	return (
		<>
			{sessions.length + todos.length > 0 && (
				<section className="overdue-strip">
					<div className="page-heading">
						<details>
							<summary>Overdue: {sessions.length + todos.length}</summary>
							<ul className="plan-sessions">
								{sessions.map((session) => (
									<SessionRow key={session.id} session={session} />
								))}
								{todos.map((todo) => (
									<TodoRow key={todo.id} todo={todo} />
								))}
							</ul>
						</details>
						<MutationButton
							disabled={busy || !sessions.length}
							onClick={replan}
						>
							{busy ? "Re-planning…" : "Re-plan"}
						</MutationButton>
					</div>
				</section>
			)}
			{error && (
				<p role="alert" className="field-error">
					{error}
				</p>
			)}
			{result && (
				<section className="replan-summary" aria-label="Re-plan result">
					<p>
						{formatHours(
							result.plans.reduce((sum, plan) => sum + plan.movedMinutes, 0),
						)}{" "}
						moved to your remaining days
					</p>
					{result.plans.map((plan) => (
						<div key={plan.deadlineId}>
							{plan.shortfallMinutes > 0 && (
								<p className="shortfall">
									{plan.title} is {formatHours(plan.shortfallMinutes)} short
								</p>
							)}
							{plan.moved.length > 0 && (
								<p>
									{plan.title}:{" "}
									{plan.moved
										.map((row) => `${row.date} · ${formatHours(row.minutes)}`)
										.join(", ")}
								</p>
							)}
						</div>
					))}
					{result.plans.some((plan) => plan.shortfallMinutes > 0) && (
						<MutationButton variant="outline" onClick={() => setShowAll(true)}>
							Re-plan all by due date
						</MutationButton>
					)}
				</section>
			)}
		</>
	);
}
