import { useEffect, useState } from "react";
import { MutationButton } from "#/components/shared/mutation-button";
import { SkeletonRows } from "#/components/shared/skeleton";
import { Button } from "#/components/ui/button";
import { ApiError } from "#/lib/api-client";
import { formatDate, formatHours } from "#/lib/format";
import {
	previewReplanAll,
	type ReplanAllRequest,
	saveReplanAll,
} from "#/lib/replan-all-query";

export function ReplanAllPreview({
	pending,
	onSaved,
	onCancel,
}: ReplanAllRequest & {
	onSaved: () => Promise<void>;
	onCancel: () => void;
}) {
	const [preview, setPreview] = useState<Awaited<
		ReturnType<typeof previewReplanAll>
	> | null>(null);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [saving, setSaving] = useState(false);
	const [attempt, setAttempt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries a failed preview request.
	useEffect(() => {
		let active = true;
		setError("");
		void previewReplanAll({ pending })
			.then((result) => {
				if (active) setPreview(result);
			})
			.catch(() => {
				if (active) setError("Couldn't preview — try again");
			});
		return () => {
			active = false;
		};
	}, [pending, attempt]);
	async function save() {
		if (!preview) return;
		setSaving(true);
		setError("");
		try {
			await saveReplanAll({ pending, previewVersion: preview.previewVersion });
			await onSaved();
		} catch (error) {
			if (error instanceof ApiError && error.code === "plan_changed") {
				setPreview(null);
				setNotice("Your plan changed. Review the updated preview.");
				setAttempt((value) => value + 1);
			} else setError("Couldn't save — try again");
		} finally {
			setSaving(false);
		}
	}
	return (
		<section className="deadline-form replan-all-preview is-draft sketch sketch-dashed sketch-draw">
			<p className="eyebrow">Soonest due, first</p>
			<h3>Re-plan all by due date</h3>
			<p>Ticked sessions stay in place. Review the new plan before saving.</p>
			{notice && <output>{notice}</output>}
			{preview ? (
				preview.plans.length ? (
					preview.plans.map((plan) => (
						<section key={plan.deadlineId} aria-label={plan.title}>
							<h4>{plan.title}</h4>
							<p>Due {formatDate(plan.dueDate)}</p>
							{plan.shortfallMinutes > 0 && (
								<p className="shortfall">
									{plan.title} is {formatHours(plan.shortfallMinutes)} short
								</p>
							)}
							{plan.keptSessions.length > 0 && (
								<>
									<h5 className="preview-label">Kept sessions</h5>
									<ul className="session-list">
										{plan.keptSessions.map((session) => (
											<li key={session.id}>
												<span>{formatDate(session.date)} · Done</span>
												<strong>{formatHours(session.minutes)}</strong>
											</li>
										))}
									</ul>
								</>
							)}
							<h5 className="preview-label">New sessions</h5>
							{plan.sessions.length ? (
								<ul className="session-list">
									{plan.sessions.map((session) => (
										<li key={session.date}>
											<time dateTime={session.date}>
												{formatDate(session.date)}
											</time>
											<strong>{formatHours(session.minutes)}</strong>
										</li>
									))}
								</ul>
							) : (
								<p>No new sessions fit this plan.</p>
							)}
						</section>
					))
				) : (
					<p>No active deadlines to re-plan.</p>
				)
			) : !error ? (
				<SkeletonRows />
			) : null}
			{error && (
				<p className="field-error" role="alert">
					{error}
				</p>
			)}
			<div className="form-actions">
				{preview ? (
					<MutationButton disabled={saving} onClick={save}>
						{saving ? "Saving…" : "Save"}
					</MutationButton>
				) : error ? (
					<Button onClick={() => setAttempt((value) => value + 1)}>
						Retry
					</Button>
				) : null}
				<Button variant="outline" disabled={saving} onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</section>
	);
}
