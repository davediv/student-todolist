import { useState } from "react";
import { FormField } from "#/components/shared/form-field";
import { SkeletonRows } from "#/components/shared/skeleton";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { ApiError } from "#/lib/api-client";
import { deadlineTypes } from "#/lib/deadlines";
import { formatDate, formatHours, localDate } from "#/lib/format";
import { addDays } from "#/lib/planner";
import { type SeriesInput, seriesSchema } from "#/lib/series";
import { createSeries, previewSeries } from "#/lib/series-query";

const weekdays = [
	[1, "Monday"],
	[2, "Tuesday"],
	[3, "Wednesday"],
	[4, "Thursday"],
	[5, "Friday"],
	[6, "Saturday"],
	[0, "Sunday"],
] as const;

export function SeriesForm({
	onSaved,
	onCancel,
}: {
	onSaved: () => Promise<void>;
	onCancel: () => void;
}) {
	const [values, setValues] = useState<SeriesInput>({
		title: "",
		type: "assignment",
		notes: "",
		estimateMinutes: 0,
		weekdays: [],
		leadDays: 7,
		endDate: "",
	});
	const [fields, setFields] = useState<Record<string, string[] | undefined>>(
		{},
	);
	const [preview, setPreview] = useState<Awaited<
		ReturnType<typeof previewSeries>
	> | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [refreshing, setRefreshing] = useState(false);
	function change<K extends keyof SeriesInput>(name: K, value: SeriesInput[K]) {
		setValues((current) => ({ ...current, [name]: value }));
	}
	async function showPreview() {
		setError("");
		setNotice("");
		const parsed = seriesSchema(localDate()).safeParse(values);
		if (!parsed.success) {
			setFields(parsed.error.flatten().fieldErrors);
			return;
		}
		setFields({});
		setBusy(true);
		try {
			setPreview(await previewSeries(parsed.data));
		} catch {
			setError("Couldn't preview — try again");
		} finally {
			setBusy(false);
		}
	}
	async function confirm() {
		if (!preview) return;
		setBusy(true);
		setError("");
		try {
			await createSeries(values, preview.previewVersion);
			await onSaved();
		} catch (error) {
			if (error instanceof ApiError && error.code === "plan_changed") {
				setNotice("Your plan changed. Review the updated preview.");
				setPreview(null);
				setRefreshing(true);
				try {
					setPreview(await previewSeries(values));
				} catch {
					setError("Couldn't preview — try again");
				} finally {
					setRefreshing(false);
				}
			} else setError("Couldn't create recurring deadline — try again");
		} finally {
			setBusy(false);
		}
	}
	if (refreshing)
		return (
			<section className="deadline-form">
				<output>{notice}</output>
				<SkeletonRows />
			</section>
		);
	if (preview)
		return (
			<section className="deadline-form series-preview">
				<p className="eyebrow">A weekly rhythm</p>
				<h3>Recurring deadline preview</h3>
				<p className="preview-title">{values.title}</p>
				{notice && <output>{notice}</output>}
				{preview.occurrences.length ? (
					preview.occurrences.map((occurrence) => (
						<section
							key={occurrence.dueDate}
							className="series-occurrence"
							aria-label={`Due ${formatDate(occurrence.dueDate)}`}
						>
							<h4>
								Due{" "}
								<time dateTime={occurrence.dueDate}>
									{formatDate(occurrence.dueDate, {
										weekday: "short",
										day: "numeric",
										month: "short",
									})}
								</time>
							</h4>
							<p>
								Starts{" "}
								<time dateTime={occurrence.startDate}>
									{formatDate(occurrence.startDate)}
								</time>
							</p>
							{occurrence.shortfallMinutes > 0 && (
								<p className="shortfall">
									{values.title} is {formatHours(occurrence.shortfallMinutes)}{" "}
									short
								</p>
							)}
							{occurrence.sessions.length ? (
								<ul className="session-list">
									{occurrence.sessions.map((session) => (
										<li key={session.date}>
											<time dateTime={session.date}>
												{formatDate(session.date)}
											</time>
											<strong>{formatHours(session.minutes)}</strong>
										</li>
									))}
								</ul>
							) : (
								<p>No study time fits before this occurrence.</p>
							)}
						</section>
					))
				) : (
					<p>No occurrences fall before the end date.</p>
				)}
				{error && (
					<p className="field-error" role="alert">
						{error}
					</p>
				)}
				<div className="form-actions">
					<Button
						disabled={busy || !preview.occurrences.length}
						onClick={confirm}
					>
						{busy ? "Creating…" : "Confirm"}
					</Button>
					<Button
						variant="outline"
						disabled={busy}
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
				void showPreview();
			}}
		>
			<h3>Add a recurring deadline</h3>
			<div className="deadline-fields">
				<FormField
					id="series-title"
					label="Title"
					error={fields.title?.join(", ")}
				>
					{(props) => (
						<Input
							{...props}
							autoComplete="off"
							value={values.title}
							disabled={busy}
							onChange={(event) => change("title", event.target.value)}
						/>
					)}
				</FormField>
				<FormField
					id="series-type"
					label="Type"
					error={fields.type?.join(", ")}
				>
					{(props) => (
						<select
							{...props}
							className="native-select"
							value={values.type}
							disabled={busy}
							onChange={(event) =>
								change("type", event.target.value as SeriesInput["type"])
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
				<FormField
					id="series-estimate"
					label="Estimate per occurrence (hours)"
					error={fields.estimateMinutes?.join(", ")}
				>
					{(props) => (
						<Input
							{...props}
							type="number"
							min={0.5}
							max={100}
							step={0.5}
							value={values.estimateMinutes ? values.estimateMinutes / 60 : ""}
							disabled={busy}
							onChange={(event) =>
								change(
									"estimateMinutes",
									Number.isFinite(event.target.valueAsNumber)
										? event.target.valueAsNumber * 60
										: 0,
								)
							}
						/>
					)}
				</FormField>
				<fieldset
					className="series-weekdays"
					aria-describedby={
						fields.weekdays ? "series-weekdays-error" : undefined
					}
					disabled={busy}
				>
					<legend>Weekdays</legend>
					<div>
						{weekdays.map(([day, label]) => (
							<label key={day}>
								<input
									type="checkbox"
									checked={values.weekdays.includes(day)}
									onChange={(event) =>
										change(
											"weekdays",
											event.target.checked
												? [...values.weekdays, day].sort((a, b) => a - b)
												: values.weekdays.filter((value) => value !== day),
										)
									}
								/>
								{label}
							</label>
						))}
					</div>
					{fields.weekdays && (
						<p id="series-weekdays-error" className="field-error" role="alert">
							{fields.weekdays.join(", ")}
						</p>
					)}
				</fieldset>
				<FormField
					id="series-lead"
					label="Lead days"
					error={fields.leadDays?.join(", ")}
				>
					{(props) => (
						<Input
							{...props}
							type="number"
							min={1}
							max={60}
							step={1}
							value={values.leadDays}
							disabled={busy}
							onChange={(event) =>
								change(
									"leadDays",
									Number.isFinite(event.target.valueAsNumber)
										? event.target.valueAsNumber
										: 0,
								)
							}
						/>
					)}
				</FormField>
				<FormField
					id="series-end"
					label="End date"
					error={fields.endDate?.join(", ")}
				>
					{(props) => (
						<Input
							{...props}
							type="date"
							min={addDays(localDate(), 1)}
							max={addDays(localDate(), 365)}
							value={values.endDate}
							disabled={busy}
							onChange={(event) => change("endDate", event.target.value)}
						/>
					)}
				</FormField>
				<FormField
					id="series-notes"
					label="Notes (optional)"
					error={fields.notes?.join(", ")}
				>
					{(props) => (
						<Textarea
							{...props}
							value={values.notes}
							disabled={busy}
							onChange={(event) => change("notes", event.target.value)}
						/>
					)}
				</FormField>
			</div>
			{error && (
				<p className="field-error" role="alert">
					{error}
				</p>
			)}
			<div className="form-actions">
				<Button type="submit" disabled={busy}>
					{busy ? "Loading…" : "Preview"}
				</Button>
				<Button
					type="button"
					variant="ghost"
					disabled={busy}
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
