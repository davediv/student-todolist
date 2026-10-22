import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormField } from "#/components/shared/form-field";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { ApiError } from "#/lib/api-client";
import { dayOffSchema } from "#/lib/days-off";
import {
	addDayOff,
	daysOffQueryOptions,
	removeDayOff,
} from "#/lib/days-off-query";
import { formatDate, formatHours, localDate } from "#/lib/format";
import { refreshPlan } from "#/lib/plan-cache";

export function DaysOffEditor() {
	const client = useQueryClient();
	const query = useQuery(daysOffQueryOptions());
	const [date, setDate] = useState("");
	const [hours, setHours] = useState("0");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [fields, setFields] = useState<Record<string, string[] | undefined>>(
		{},
	);
	async function refresh() {
		await Promise.all([
			client.invalidateQueries({ queryKey: ["days-off"] }),
			refreshPlan(client),
		]);
	}
	async function add() {
		setError("");
		const parsed = dayOffSchema(localDate()).safeParse({
			date,
			limitMinutes: hours === "" ? Number.NaN : Number(hours) * 60,
		});
		if (!parsed.success) {
			setFields(parsed.error.flatten().fieldErrors);
			return;
		}
		setFields({});
		setBusy("add");
		try {
			await addDayOff(parsed.data);
			setDate("");
			setHours("0");
			await refresh();
		} catch (cause) {
			setError(
				cause instanceof ApiError ? cause.message : "Couldn't save — try again",
			);
		} finally {
			setBusy(null);
		}
	}
	async function remove(id: string) {
		setError("");
		setBusy(id);
		try {
			await removeDayOff(id);
			await refresh();
		} catch {
			setError("Couldn't remove — try again");
		} finally {
			setBusy(null);
		}
	}
	return (
		<section className="settings-section">
			<h3>Days off</h3>
			<p className="page-description">
				Set a different limit for one date. Existing sessions stay where they
				are.
			</p>
			<form
				className="days-off-form"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void add();
				}}
			>
				<FormField
					id="day-off-date"
					label="Day off date"
					error={fields.date?.join(", ")}
				>
					{(props) => (
						<Input
							{...props}
							type="date"
							min={localDate()}
							value={date}
							onChange={(event) => setDate(event.target.value)}
							disabled={busy !== null}
						/>
					)}
				</FormField>
				<FormField
					id="day-off-hours"
					label="Day off limit (hours)"
					error={
						fields.limitMinutes
							? "Choose 0–12 hours in half-hour steps"
							: undefined
					}
				>
					{(props) => (
						<Input
							{...props}
							type="number"
							min={0}
							max={12}
							step={0.5}
							value={hours}
							onChange={(event) => setHours(event.target.value)}
							disabled={busy !== null}
						/>
					)}
				</FormField>
				<Button type="submit" disabled={busy !== null}>
					{busy === "add" ? "Adding…" : "Add day off"}
				</Button>
			</form>
			{error && (
				<p role="alert" className="field-error">
					{error}
				</p>
			)}
			{query.isPending ? (
				<output>Loading days off…</output>
			) : query.isError ? (
				<p role="alert">
					Couldn't load days off.{" "}
					<Button variant="ghost" onClick={() => void query.refetch()}>
						Retry days off
					</Button>
				</p>
			) : query.data.length ? (
				<ul className="days-off-list">
					{query.data.map((row) => (
						<li key={row.id}>
							<span>
								<time dateTime={row.date}>
									{formatDate(row.date, {
										month: "short",
										day: "numeric",
										year: "numeric",
									})}
								</time>{" "}
								· {formatHours(row.limitMinutes)}
							</span>
							<Button
								variant="ghost"
								disabled={busy !== null}
								onClick={() => void remove(row.id)}
								aria-label={`Remove day off ${formatDate(row.date)}`}
							>
								{busy === row.id ? "Removing…" : "Remove"}
							</Button>
						</li>
					))}
				</ul>
			) : (
				<p className="day-empty">No upcoming days off</p>
			)}
		</section>
	);
}
