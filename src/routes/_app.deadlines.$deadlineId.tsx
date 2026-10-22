import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { DeadlineActions } from "#/components/deadlines/deadline-actions";
import { DeadlineForm } from "#/components/deadlines/deadline-form";
import { TypeIcon } from "#/components/deadlines/type-icon";
import { SessionMenu } from "#/components/plan/session-menu";
import {
	ScopeDialog,
	type SeriesScope,
} from "#/components/series/scope-dialog";
import { SeriesScopeForm } from "#/components/series/series-scope-form";
import { Button } from "#/components/ui/button";
import { deadlineQueryOptions } from "#/lib/deadlines-query";
import { formatDate, formatHours } from "#/lib/format";
import { refreshPlan } from "#/lib/plan-cache";
export const Route = createFileRoute("/_app/deadlines/$deadlineId")({
	validateSearch: (
		search: Record<string, unknown>,
	): { edit?: boolean; focusDue?: boolean } => ({
		edit: search.edit === true || search.edit === "true",
		focusDue: search.focusDue === true || search.focusDue === "true",
	}),
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			deadlineQueryOptions(params.deadlineId),
		),
	component: DeadlineDetail,
});
function DeadlineDetail() {
	const [editing, setEditing] = useState(false);
	const [editScope, setEditScope] = useState<SeriesScope | null>(null);
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const client = useQueryClient();
	const { deadlineId } = Route.useParams();
	const {
		data: { deadline, sessions },
	} = useSuspenseQuery(deadlineQueryOptions(deadlineId));
	const showEdit = deadline.status === "active" && (editing || search.edit);
	async function closeEdit() {
		setEditing(false);
		setEditScope(null);
		if (search.edit || search.focusDue)
			await navigate({ search: {}, replace: true });
	}
	return (
		<>
			<Link to="/deadlines" className="back-link">
				← Deadlines
			</Link>
			<TypeIcon type={deadline.type} />
			<h2>{deadline.title}</h2>
			<p className="page-description">
				Due {formatDate(deadline.dueDate)} · {deadline.tickedMinutes / 60} /{" "}
				{formatHours(deadline.estimateMinutes)}
			</p>
			{deadline.status === "active" && deadline.unplannedMinutes > 0 && (
				<p className="shortfall">
					{formatHours(deadline.unplannedMinutes)} unplanned
				</p>
			)}
			{deadline.notes && <p className="deadline-notes">{deadline.notes}</p>}
			{deadline.status === "active" && !showEdit && (
				<Button onClick={() => setEditing(true)}>Edit</Button>
			)}
			{!showEdit && <DeadlineActions deadline={deadline} detail />}
			{showEdit && deadline.seriesId && !editScope && (
				<ScopeDialog
					open
					action="edit"
					onOpenChange={(open) => {
						if (!open) void closeEdit();
					}}
					onSelect={setEditScope}
				/>
			)}
			{showEdit && deadline.seriesId && editScope === "following" && (
				<SeriesScopeForm
					seriesId={deadline.seriesId}
					occurrence={deadline}
					onCancel={() => {
						void closeEdit();
					}}
					onSaved={async () => {
						await navigate({ to: "/deadlines" });
						client.removeQueries({
							queryKey: ["deadline", deadline.id],
							exact: true,
						});
						await refreshPlan(client);
					}}
				/>
			)}
			{showEdit && (!deadline.seriesId || editScope === "this") && (
				<DeadlineForm
					deadlineId={deadlineId}
					initial={deadline}
					focusDue={search.focusDue}
					onCancel={() => {
						void closeEdit();
					}}
					onSaved={async () => {
						await refreshPlan(client);
						await closeEdit();
					}}
				/>
			)}
			<section className="settings-section">
				<h3>Study sessions</h3>
				{sessions.length ? (
					<ul className="session-list">
						{sessions.map((session) => (
							<li key={session.id}>
								<span>
									{formatDate(session.date, {
										weekday: "short",
										month: "short",
										day: "numeric",
									})}
									{session.ticked ? " · Done" : ""}
								</span>
								<strong>{formatHours(session.minutes)}</strong>
								<SessionMenu
									session={{
										...session,
										title: deadline.title,
										dueDate: deadline.dueDate,
									}}
								/>
							</li>
						))}
					</ul>
				) : (
					<p>No study sessions planned.</p>
				)}
			</section>
		</>
	);
}
