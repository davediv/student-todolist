import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
	ScopeDialog,
	type SeriesScope,
} from "#/components/series/scope-dialog";
import { ConfirmDialog } from "#/components/shared/confirm-dialog";
import { MutationButton } from "#/components/shared/mutation-button";
import { deleteDeadline, markDeadlineDone } from "#/lib/deadlines-query";
import { localDate } from "#/lib/format";
import { useOnline } from "#/lib/offline";
import { refreshPlan } from "#/lib/plan-cache";
import { deleteSeriesFollowing } from "#/lib/series-scope-query";

export function DeadlineActions({
	deadline,
	detail = false,
}: {
	deadline: {
		id: string;
		title: string;
		status: "active" | "done";
		seriesId?: string | null;
		dueDate: string;
	};
	detail?: boolean;
}) {
	const client = useQueryClient();
	const online = useOnline();
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [scopeOpen, setScopeOpen] = useState(false);
	const [deleteScope, setDeleteScope] = useState<SeriesScope | null>(null);
	const deleteButton = useRef<HTMLButtonElement>(null);
	async function markDone() {
		setBusy(true);
		setError("");
		try {
			await markDeadlineDone(deadline.id);
			await refreshPlan(client);
		} catch {
			setError("Couldn't mark done — try again");
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="deadline-actions">
			{deadline.status === "active" && (
				<MutationButton variant="outline" disabled={busy} onClick={markDone}>
					{busy ? "Saving…" : "Mark done"}
				</MutationButton>
			)}
			{deadline.status === "active" &&
				deadline.dueDate < localDate() &&
				(online ? (
					<Link
						to="/deadlines/$deadlineId"
						params={{ deadlineId: deadline.id }}
						search={{ edit: true, focusDue: true }}
						className="back-link"
					>
						Extend due date
					</Link>
				) : (
					<MutationButton variant="link">Extend due date</MutationButton>
				))}
			{deadline.seriesId && (
				<>
					<MutationButton
						ref={deleteButton}
						variant="ghost"
						disabled={busy}
						onClick={() => setScopeOpen(true)}
					>
						Delete
					</MutationButton>
					<ScopeDialog
						open={scopeOpen}
						returnFocus={() => deleteButton.current}
						action="delete"
						onOpenChange={setScopeOpen}
						onSelect={(scope) => {
							setScopeOpen(false);
							setDeleteScope(scope);
						}}
					/>
				</>
			)}
			<ConfirmDialog
				returnFocus={deadline.seriesId ? () => deleteButton.current : undefined}
				open={deadline.seriesId ? deleteScope !== null : undefined}
				onOpenChange={(open) => {
					if (!open) setDeleteScope(null);
				}}
				title={
					deleteScope === "following"
						? "Delete this and following occurrences?"
						: `Delete ${deadline.title}?`
				}
				description={
					deleteScope === "following"
						? "This occurrence and every later occurrence that is not Done will be permanently removed, with their study sessions."
						: "This deadline and all its study sessions will be permanently removed."
				}
				trigger={
					deadline.seriesId ? null : (
						<MutationButton variant="ghost" disabled={busy}>
							Delete
						</MutationButton>
					)
				}
				onConfirm={async () => {
					if (deadline.seriesId && deleteScope === "following") {
						await deleteSeriesFollowing(deadline.seriesId, deadline.id);
						await client.invalidateQueries({
							queryKey: ["series", deadline.seriesId],
						});
					} else await deleteDeadline(deadline.id);
					if (detail) await navigate({ to: "/deadlines" });
					client.removeQueries({
						queryKey: ["deadline", deadline.id],
						exact: true,
					});
					await refreshPlan(client);
				}}
			/>
			{error && (
				<p role="alert" className="field-error">
					{error}
				</p>
			)}
		</div>
	);
}
