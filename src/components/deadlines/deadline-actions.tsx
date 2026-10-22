import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmDialog } from "#/components/shared/confirm-dialog";
import { Button } from "#/components/ui/button";
import { deleteDeadline, markDeadlineDone } from "#/lib/deadlines-query";
import { localDate } from "#/lib/format";
import { refreshPlan } from "#/lib/plan-cache";

export function DeadlineActions({
	deadline,
	detail = false,
}: {
	deadline: {
		id: string;
		title: string;
		status: "active" | "done";
		dueDate: string;
	};
	detail?: boolean;
}) {
	const client = useQueryClient();
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
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
				<Button variant="outline" disabled={busy} onClick={markDone}>
					{busy ? "Saving…" : "Mark done"}
				</Button>
			)}
			{deadline.status === "active" && deadline.dueDate < localDate() && (
				<Link
					to="/deadlines/$deadlineId"
					params={{ deadlineId: deadline.id }}
					search={{ edit: true, focusDue: true }}
					className="back-link"
				>
					Extend due date
				</Link>
			)}
			<ConfirmDialog
				title={`Delete ${deadline.title}?`}
				description="This deadline and all its study sessions will be permanently removed."
				trigger={
					<Button variant="ghost" disabled={busy}>
						Delete
					</Button>
				}
				onConfirm={async () => {
					await deleteDeadline(deadline.id);
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
