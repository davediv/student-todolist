import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TypeIcon } from "#/components/deadlines/type-icon";
import { deadlineQueryOptions } from "#/lib/deadlines-query";
import { formatDate, formatHours } from "#/lib/format";
export const Route = createFileRoute("/_app/deadlines/$deadlineId")({
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			deadlineQueryOptions(params.deadlineId),
		),
	component: DeadlineDetail,
});
function DeadlineDetail() {
	const { deadlineId } = Route.useParams();
	const {
		data: { deadline, sessions },
	} = useSuspenseQuery(deadlineQueryOptions(deadlineId));
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
			{deadline.unplannedMinutes > 0 && (
				<p className="shortfall">
					{formatHours(deadline.unplannedMinutes)} unplanned
				</p>
			)}
			{deadline.notes && <p className="deadline-notes">{deadline.notes}</p>}
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
