import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	BookOpen,
	FileText,
	GraduationCap,
	Layers,
	Shapes,
} from "lucide-react";
import { apiClient } from "#/lib/api-client";
import type { DaySession } from "#/lib/days-query";
import { formatDate, formatHours } from "#/lib/format";
import { refreshPlan } from "#/lib/plan-cache";
import { SessionMenu } from "./session-menu";

const icons = {
	assignment: FileText,
	exam: GraduationCap,
	project: Layers,
	reading: BookOpen,
	other: Shapes,
};
export function SessionRow({ session }: { session: DaySession }) {
	const queryClient = useQueryClient();
	const tick = useMutation({
		mutationFn: async (ticked: boolean) => {
			await apiClient.api.sessions[":id"].$patch({
				param: { id: session.id },
				json: { ticked },
			});
		},
		onSuccess: () => refreshPlan(queryClient),
	});
	const Icon = icons[session.type];
	return (
		<li className={`session-row${session.ticked ? " is-ticked" : ""}`}>
			<div className="session-main" aria-busy={tick.isPending}>
				<input
					type="checkbox"
					checked={session.ticked}
					disabled={tick.isPending}
					aria-label={`${session.title}, ${formatHours(session.minutes)}`}
					onChange={(event) => tick.mutate(event.target.checked)}
				/>
				<Icon size={20} aria-hidden="true" />
				<div className="session-copy">
					<Link
						to="/deadlines/$deadlineId"
						params={{ deadlineId: session.deadlineId }}
						className="session-title"
						style={
							session.ticked ? { textDecoration: "line-through" } : undefined
						}
					>
						{session.title}
					</Link>
					<p className="session-meta">
						<span>{session.type}</span> · Due{" "}
						<time dateTime={session.dueDate}>
							{formatDate(session.dueDate)}
						</time>
					</p>
				</div>
				<strong>{formatHours(session.minutes)}</strong>
				<SessionMenu session={session} disabled={tick.isPending} />
			</div>
			{tick.isError && (
				<p className="field-error" role="alert">
					Couldn't update {session.title} — try again
				</p>
			)}
		</li>
	);
}
