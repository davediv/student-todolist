import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { FormField } from "#/components/shared/form-field";
import { SkeletonRows } from "#/components/shared/skeleton";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { ApiError } from "#/lib/api-client";
import { type DeadlineInput, deadlineTypes } from "#/lib/deadlines";
import { formatDate, formatHours, localDate } from "#/lib/format";
import { addDays } from "#/lib/planner";
import { type SeriesScopeInput, seriesScopeSchema } from "#/lib/series-scope";
import {
	previewSeriesScope,
	saveSeriesScope,
	seriesQueryOptions,
} from "#/lib/series-scope-query";

type ScopeValues = {
	title: string;
	type: DeadlineInput["type"];
	notes: string;
	estimateMinutes: number;
	leadDays: number;
	endDate: string;
};
type Props = {
	seriesId: string;
	occurrence: DeadlineInput & { id: string };
	onSaved: () => Promise<void>;
	onCancel: () => void;
};

export function SeriesScopeForm(props: Props) {
	const query = useQuery(seriesQueryOptions(props.seriesId));
	const client = useQueryClient();
	const [initialized, setInitialized] = useState(false);
	useEffect(() => {
		if (query.isSuccess && !query.isFetching) setInitialized(true);
	}, [query.isSuccess, query.isFetching]);
	if (query.isError && !initialized)
		return (
			<section className="deadline-form">
				<p role="alert">Couldn't load recurring deadline — try again</p>
				<div className="form-actions">
					<Button onClick={() => void query.refetch()}>Retry</Button>
					<Button variant="outline" onClick={props.onCancel}>
						Cancel
					</Button>
				</div>
			</section>
		);
	if (!initialized || !query.data)
		return (
			<section className="deadline-form">
				<SkeletonRows />
				<Button variant="outline" onClick={props.onCancel}>
					Cancel
				</Button>
			</section>
		);
	return (
		<ScopeFields
			{...props}
			initial={{
				title: props.occurrence.title,
				type: props.occurrence.type,
				notes: props.occurrence.notes ?? "",
				estimateMinutes: props.occurrence.estimateMinutes,
				leadDays: query.data.series.leadDays,
				endDate: query.data.series.endDate,
			}}
			onSaved={async () => {
				await props.onSaved();
				await client.invalidateQueries({
					queryKey: ["series", props.seriesId],
				});
			}}
		/>
	);
}

function ScopeFields({
	seriesId,
	occurrence,
	initial,
	onSaved,
	onCancel,
}: Props & { initial: ScopeValues }) {
	const [values, setValues] = useState(initial);
	const [baseline] = useState(initial);
	const titleInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		titleInput.current?.focus();
	}, []);
	const [fields, setFields] = useState<Record<string, string[] | undefined>>(
		{},
	);
	const [preview, setPreview] = useState<Awaited<
		ReturnType<typeof previewSeriesScope>
	> | null>(null);
	const [busy, setBusy] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	function patch(): SeriesScopeInput {
		return Object.fromEntries(
			(Object.keys(baseline) as (keyof ScopeValues)[])
				.filter((key) => values[key] !== baseline[key])
				.map((key) => [key, values[key]]),
		);
	}
	function change<K extends keyof ScopeValues>(name: K, value: ScopeValues[K]) {
		setValues((current) => ({ ...current, [name]: value }));
	}
	async function showPreview() {
		setError("");
		setNotice("");
		const parsed = seriesScopeSchema(localDate(), baseline.endDate).safeParse(
			patch(),
		);
		if (!parsed.success) {
			setFields(parsed.error.flatten().fieldErrors);
			return;
		}
		setFields({});
		setBusy(true);
		try {
			setPreview(
				await previewSeriesScope(seriesId, occurrence.id, parsed.data),
			);
		} catch {
			setError("Couldn't preview — try again");
		} finally {
			setBusy(false);
		}
	}
	async function save() {
		if (!preview) return;
		setBusy(true);
		setError("");
		try {
			await saveSeriesScope(
				seriesId,
				occurrence.id,
				patch(),
				preview.previewVersion,
			);
			await onSaved();
		} catch (error) {
			if (error instanceof ApiError && error.code === "plan_changed") {
				setPreview(null);
				setRefreshing(true);
				setNotice("Your plan changed. Review the updated preview.");
				try {
					setPreview(
						await previewSeriesScope(seriesId, occurrence.id, patch()),
					);
				} catch {
					setError("Couldn't preview — try again");
				} finally {
					setRefreshing(false);
				}
			} else setError("Couldn't save recurring deadline changes — try again");
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
				<h3>This and following preview</h3>
				{notice && <output>{notice}</output>}
				{preview.occurrences.map((item) => (
					<section
						key={item.id}
						className="series-occurrence"
						aria-label={`${item.action === "create" ? "New" : "Updated"} ${item.title}, due ${item.dueDate}`}
					>
						<h4>{item.title}</h4>
						<p>
							{item.action === "create"
								? "New occurrence"
								: "Updated occurrence"}{" "}
							· {item.type} · {formatHours(item.estimateMinutes)}
						</p>
						<p>
							Due{" "}
							<time dateTime={item.dueDate}>{formatDate(item.dueDate)}</time> ·
							Starts{" "}
							<time dateTime={item.startDate}>
								{formatDate(item.startDate)}
							</time>
						</p>
						{item.notes && <p>{item.notes}</p>}
						{item.shortfallMinutes > 0 && (
							<p className="shortfall">
								{item.title} is {formatHours(item.shortfallMinutes)} short
							</p>
						)}
						{item.keptSessions.length > 0 && (
							<>
								<h5>Kept sessions</h5>
								<ul className="session-list">
									{item.keptSessions.map((session) => (
										<li key={session.id}>
											<span>{formatDate(session.date)} · Done</span>
											<strong>{formatHours(session.minutes)}</strong>
										</li>
									))}
								</ul>
							</>
						)}
						<h5>New sessions</h5>
						{item.sessions.length ? (
							<ul className="session-list">
								{item.sessions.map((session) => (
									<li key={session.date}>
										<time dateTime={session.date}>
											{formatDate(session.date)}
										</time>
										<strong>{formatHours(session.minutes)}</strong>
									</li>
								))}
							</ul>
						) : (
							<p>No new study sessions planned.</p>
						)}
					</section>
				))}
				{preview.removed.length > 0 && (
					<section aria-label="Removed occurrences">
						<h4>Removed occurrences</h4>
						<ul className="session-list">
							{preview.removed.map((item) => (
								<li key={item.id}>
									<span>{item.title}</span>
									<time dateTime={item.dueDate}>
										{formatDate(item.dueDate)}
									</time>
								</li>
							))}
						</ul>
					</section>
				)}
				{error && (
					<p role="alert" className="field-error">
						{error}
					</p>
				)}
				<div className="form-actions">
					<Button disabled={busy} onClick={save}>
						{busy ? "Saving…" : "Save"}
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
			<h3>Edit this and following</h3>
			<p>Earlier and Done occurrences stay unchanged.</p>
			<div className="deadline-fields">
				<FormField
					id="scope-title"
					label="Title"
					error={fields.title?.join(", ")}
				>
					{(props) => (
						<Input
							ref={titleInput}
							{...props}
							value={values.title}
							disabled={busy}
							onChange={(event) => change("title", event.target.value)}
						/>
					)}
				</FormField>
				<FormField id="scope-type" label="Type" error={fields.type?.join(", ")}>
					{(props) => (
						<select
							{...props}
							className="native-select"
							value={values.type}
							disabled={busy}
							onChange={(event) =>
								change("type", event.target.value as ScopeValues["type"])
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
					id="scope-estimate"
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
							value={values.estimateMinutes / 60 || ""}
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
				<FormField
					id="scope-lead"
					label="Lead days"
					error={fields.leadDays?.join(", ")}
				>
					{(props) => (
						<Input
							{...props}
							type="number"
							min={1}
							max={60}
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
					id="scope-end"
					label="End date"
					error={fields.endDate?.join(", ")}
				>
					{(props) => (
						<Input
							{...props}
							type="date"
							max={addDays(localDate(), 365)}
							value={values.endDate}
							disabled={busy}
							onChange={(event) => change("endDate", event.target.value)}
						/>
					)}
				</FormField>
				<FormField
					id="scope-notes"
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
				<p role="alert" className="field-error">
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
