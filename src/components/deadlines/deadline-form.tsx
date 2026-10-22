import { useForm } from "@tanstack/react-form";
import { useRef, useState } from "react";
import { z } from "zod";
import { FormField } from "#/components/shared/form-field";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
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
}: {
	onSaved: () => Promise<void>;
	onCancel: () => void;
}) {
	const manualStart = useRef(false);
	const [preview, setPreview] = useState<Awaited<
		ReturnType<typeof previewDeadline>
	> | null>(null);
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const form = useForm({
		defaultValues: {
			title: "",
			type: "assignment" as DeadlineInput["type"],
			dueDate: "",
			startDate: "",
			estimateMinutes: 0,
			notes: "",
		} as DeadlineInput,
		validators: {
			onChange: deadlineSchema(localDate()),
			onSubmit: deadlineSchema(localDate()),
		},
		onSubmit: async ({ value }) => {
			setError("");
			try {
				setPreview(await previewDeadline(value));
			} catch {
				setError("Couldn't preview — try again");
			}
		},
	});
	async function save() {
		setSaving(true);
		setError("");
		try {
			await createDeadline(form.state.values);
			await onSaved();
		} catch {
			setError("Couldn't save — try again");
		} finally {
			setSaving(false);
		}
	}
	if (preview)
		return (
			<section className="deadline-form">
				<p className="eyebrow">A day-sized plan</p>
				<h3>Plan preview</h3>
				<p className="preview-title">{form.state.values.title}</p>
				{preview.shortfallMinutes > 0 && (
					<output className="shortfall">
						{form.state.values.title.trim()} is{" "}
						{formatHours(preview.shortfallMinutes)} short
					</output>
				)}
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
					<p>No study time fits before the due date.</p>
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
			<h3>Add a deadline</h3>
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
							{busy ? "Planning…" : "Preview plan"}
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
