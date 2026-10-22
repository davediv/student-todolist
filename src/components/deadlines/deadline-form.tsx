import { useForm } from "@tanstack/react-form";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ReplanAllPreview } from "#/components/plan/replan-all-preview";
import { FormField } from "#/components/shared/form-field";
import { SkeletonRows } from "#/components/shared/skeleton";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { ApiError } from "#/lib/api-client";
import { previewDeadlineEdit, updateDeadline } from "#/lib/deadline-edit-query";
import {
	type DeadlineInput,
	deadlineSchema,
	deadlineTypes,
} from "#/lib/deadlines";
import { createDeadline, previewDeadline } from "#/lib/deadlines-query";
import { formatDate, formatHours, localDate } from "#/lib/format";
import { addDays } from "#/lib/planner";

function messages(errors: unknown[]) {
	return [
		...new Set(
			errors.map((error) =>
				typeof error === "string"
					? error
					: ((error as { message?: string })?.message ?? ""),
			),
		),
	].join(", ");
}
export function DeadlineForm({
	onSaved,
	onCancel,
	initial,
	deadlineId,
	focusDue = false,
}: {
	onSaved: () => Promise<void>;
	onCancel: () => void;
	initial?: DeadlineInput;
	deadlineId?: string;
	focusDue?: boolean;
}) {
	useEffect(() => {
		if (focusDue) document.getElementById("deadline-due")?.focus();
	}, [focusDue]);
	const manualStart = useRef(Boolean(initial));
	const [preview, setPreview] = useState<
		| (Awaited<ReturnType<typeof previewDeadline>> & {
				keptSessions?: { id: string; date: string; minutes: number }[];
				previewVersion?: { revision: number; today: string };
		  })
		| null
	>(null);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [refreshing, setRefreshing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [replanAll, setReplanAll] = useState(false);
	function planningChanged(value: DeadlineInput) {
		return (
			!initial ||
			value.dueDate !== initial.dueDate ||
			value.startDate !== initial.startDate ||
			value.estimateMinutes !== initial.estimateMinutes
		);
	}
	const schema = deadlineSchema(
		initial ? "0000-00-00" : localDate(),
	).superRefine((value, context) => {
		if (initial && planningChanged(value) && value.dueDate <= localDate()) {
			context.addIssue({
				code: "custom",
				path: ["dueDate"],
				message: "Due date must be after today",
			});
		}
	});
	const form = useForm({
		defaultValues: {
			title: "",
			type: "assignment" as DeadlineInput["type"],
			dueDate: "",
			startDate: "",
			estimateMinutes: 0,
			notes: "",
			...initial,
		} as DeadlineInput,
		validators: {
			onChange: schema,
			onSubmit: schema,
		},
		onSubmit: async ({ value }) => {
			setError("");
			setNotice("");
			try {
				if (deadlineId && !planningChanged(value)) {
					await updateDeadline(deadlineId, value);
					await onSaved();
				} else {
					setPreview(
						await (deadlineId
							? previewDeadlineEdit(deadlineId, value)
							: previewDeadline(value)),
					);
				}
			} catch {
				setError(
					deadlineId && !planningChanged(value)
						? "Couldn't save — try again"
						: "Couldn't preview — try again",
				);
			}
		},
	});
	async function save() {
		setSaving(true);
		setError("");
		try {
			if (deadlineId)
				await updateDeadline(
					deadlineId,
					form.state.values,
					preview?.previewVersion,
				);
			else await createDeadline(form.state.values);
			await onSaved();
		} catch (error) {
			if (
				deadlineId &&
				error instanceof ApiError &&
				error.code === "plan_changed"
			) {
				setNotice("Your plan changed. Review the updated preview.");
				setRefreshing(true);
				setPreview(null);
				try {
					setPreview(await previewDeadlineEdit(deadlineId, form.state.values));
				} catch {
					setError("Couldn't preview — try again");
				} finally {
					setRefreshing(false);
				}
			} else setError("Couldn't save — try again");
		} finally {
			setSaving(false);
		}
	}
	if (refreshing)
		return (
			<section className="deadline-form">
				<output>{notice}</output>
				<SkeletonRows />
			</section>
		);
	if (replanAll)
		return (
			<ReplanAllPreview
				pending={{ id: deadlineId, input: form.state.values }}
				onSaved={onSaved}
				onCancel={() => setReplanAll(false)}
			/>
		);
	if (preview)
		return (
			<section className="deadline-form">
				<p className="eyebrow">A day-sized plan</p>
				<h3>Plan preview</h3>
				{notice && <output>{notice}</output>}
				<p className="preview-title">{form.state.values.title}</p>
				{preview.shortfallMinutes > 0 && (
					<output className="shortfall">
						{form.state.values.title.trim()} is{" "}
						{formatHours(preview.shortfallMinutes)} short
					</output>
				)}
				{preview.shortfallMinutes > 0 && (
					<Button
						variant="outline"
						disabled={saving}
						onClick={() => setReplanAll(true)}
					>
						Re-plan all by due date
					</Button>
				)}
				{preview.keptSessions && preview.keptSessions.length > 0 && (
					<>
						<h4>Kept sessions</h4>
						<ul className="session-list">
							{preview.keptSessions.map((session) => (
								<li key={session.id}>
									<span>
										{formatDate(session.date, {
											weekday: "short",
											month: "short",
											day: "numeric",
										})}{" "}
										· Done
									</span>
									<strong>{formatHours(session.minutes)}</strong>
								</li>
							))}
						</ul>
					</>
				)}
				{deadlineId && <h4>New sessions</h4>}
				{preview.sessions.length ? (
					<ul className="session-list">
						{preview.sessions.map((session) => (
							<li key={session.date}>
								<span>
									{formatDate(session.date, {
										weekday: "short",
										month: "short",
										day: "numeric",
									})}
								</span>
								<strong>{formatHours(session.minutes)}</strong>
							</li>
						))}
					</ul>
				) : (
					<p>
						{preview.shortfallMinutes > 0
							? "No study time fits before the due date."
							: "No new study sessions needed."}
					</p>
				)}
				{error && (
					<p className="field-error" role="alert">
						{error}
					</p>
				)}
				<div className="form-actions">
					<Button disabled={saving} onClick={save}>
						{saving ? "Saving…" : "Save"}
					</Button>
					<Button
						variant="outline"
						disabled={saving}
						onClick={() => {
							setPreview(null);
							setError("");
							setNotice("");
						}}
					>
						Cancel
					</Button>
				</div>
			</section>
		);
	return (
		<form
			className="deadline-form"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<h3>{deadlineId ? "Edit deadline" : "Add a deadline"}</h3>
			<div className="deadline-fields">
				<form.Field name="title">
					{(field) => (
						<FormField
							id="deadline-title"
							label="Title"
							error={messages(field.state.meta.errors)}
						>
							{(props) => (
								<Input
									{...props}
									autoComplete="off"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							)}
						</FormField>
					)}
				</form.Field>
				<form.Field name="type">
					{(field) => (
						<FormField
							id="deadline-type"
							label="Type"
							error={messages(field.state.meta.errors)}
						>
							{(props) => (
								<select
									{...props}
									className="native-select"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(
											event.target.value as DeadlineInput["type"],
										)
									}
								>
									{deadlineTypes.map((type) => (
										<option key={type} value={type}>
											{type[0].toUpperCase() + type.slice(1)}
										</option>
									))}
								</select>
							)}
						</FormField>
					)}
				</form.Field>
				<form.Field name="dueDate">
					{(field) => (
						<FormField
							id="deadline-due"
							label="Due date"
							error={messages(field.state.meta.errors)}
						>
							{(props) => (
								<Input
									{...props}
									type="date"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => {
										const value = event.target.value;
										field.handleChange(value);
										if (
											!manualStart.current &&
											z.iso.date().safeParse(value).success
										) {
											try {
												form.setFieldValue("startDate", addDays(value, -7));
											} catch {
												form.setFieldValue("startDate", "");
											}
										}
									}}
								/>
							)}
						</FormField>
					)}
				</form.Field>
				<form.Field name="startDate">
					{(field) => (
						<FormField
							id="deadline-start"
							label="Start date"
							error={messages(field.state.meta.errors)}
						>
							{(props) => (
								<Input
									{...props}
									type="date"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => {
										manualStart.current = true;
										field.handleChange(event.target.value);
									}}
								/>
							)}
						</FormField>
					)}
				</form.Field>
				<form.Field name="estimateMinutes">
					{(field) => (
						<FormField
							id="deadline-estimate"
							label="Estimate (hours)"
							error={messages(field.state.meta.errors)}
						>
							{(props) => (
								<Input
									{...props}
									type="number"
									min={0.5}
									max={100}
									step={0.5}
									value={field.state.value ? field.state.value / 60 : ""}
									onBlur={field.handleBlur}
									onChange={(event) =>
										field.handleChange(
											Number.isFinite(event.target.valueAsNumber)
												? event.target.valueAsNumber * 60
												: 0,
										)
									}
								/>
							)}
						</FormField>
					)}
				</form.Field>
				<form.Field name="notes">
					{(field) => (
						<FormField
							id="deadline-notes"
							label="Notes (optional)"
							error={messages(field.state.meta.errors)}
						>
							{(props) => (
								<Textarea
									{...props}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							)}
						</FormField>
					)}
				</form.Field>
			</div>
			{error && (
				<p className="field-error" role="alert">
					{error}
				</p>
			)}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(busy) => (
					<div className="form-actions">
						<Button type="submit" disabled={busy}>
							{busy ? "Saving…" : deadlineId ? "Save" : "Preview plan"}
						</Button>
						<Button
							type="button"
							variant="ghost"
							onClick={onCancel}
							disabled={busy}
						>
							Cancel
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}
