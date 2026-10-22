import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { formatHours } from "#/lib/format";
import {
	overdueQueryOptions,
	replanOverdueSessions,
} from "#/lib/overdue-query";
import { refreshPlan } from "#/lib/plan-cache";
import { SessionRow } from "./session-row";
export function OverdueStrip() {
	const query = useQuery(overdueQueryOptions());
	const client = useQueryClient();
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
	return (
		<>
			{sessions.length > 0 && (
				<section className="overdue-strip">
					<div className="page-heading">
						<details>
							<summary>Overdue: {sessions.length}</summary>
							<ul className="plan-sessions">
								{sessions.map((session) => (
									<SessionRow key={session.id} session={session} />
								))}
							</ul>
						</details>
						<Button disabled={busy} onClick={replan}>
							{busy ? "Re-planning…" : "Re-plan"}
						</Button>
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
				</section>
			)}
		</>
	);
}
