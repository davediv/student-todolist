import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Dialog } from "radix-ui";
import type { CSSProperties } from "react";
import { Button } from "#/components/ui/button";
import { formatDate } from "#/lib/format";
import { useOnline } from "#/lib/offline";
import { savedQuery } from "#/lib/offline-cache";
import { type WeekStats, weeklyStatsQueryOptions } from "#/lib/stats-query";
import { weekStart } from "#/lib/week";
import "./weekly-card.css";

function hours(week: WeekStats) {
	return `${week.doneMinutes / 60} / ${week.plannedMinutes / 60}h`;
}

function WeekBar({ week, label }: { week: WeekStats; label: string }) {
	return (
		<span
			className="meter meter-week"
			style={
				{
					"--meter-units": Math.min(Math.max(week.plannedMinutes / 60, 1), 60),
				} as CSSProperties
			}
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuenow={week.doneMinutes / 60}
			aria-valuemax={week.plannedMinutes / 60}
			aria-valuetext={`${week.doneMinutes / 60} of ${week.plannedMinutes / 60} hours done`}
		>
			<span
				className="meter-fill"
				style={{
					width: `${week.plannedMinutes ? (week.doneMinutes / week.plannedMinutes) * 100 : 0}%`,
				}}
			/>
		</span>
	);
}

export function WeeklyCard({ today }: { today: string }) {
	const client = useQueryClient();
	const online = useOnline();
	const query = useQuery(weeklyStatsQueryOptions(today));
	const data =
		query.data ??
		(!online
			? savedQuery<{ weeks: WeekStats[] }>(client, ["stats", "weekly"])
			: undefined);
	if (!data && !online)
		return (
			<p className="weekly-card sketch sketch-dashed">
				No saved weekly progress. Connect to load it.
			</p>
		);
	if (!data && query.isPending)
		return (
			<output className="weekly-card sketch sketch-dashed">
				Loading weekly progress…
			</output>
		);
	if (query.isError && !data)
		return (
			<div className="weekly-card sketch sketch-danger" role="alert">
				<p>Couldn't load weekly progress</p>
				<Button variant="outline" onClick={() => void query.refetch()}>
					Retry weekly progress
				</Button>
			</div>
		);
	if (!data) return null;
	const weeks = data.weeks;
	const current = weeks[0];
	const currentLabel =
		current.startDate === weekStart(today)
			? "This week"
			: `Week of ${formatDate(current.startDate, undefined, "en-GB")}`;
	return (
		<Dialog.Root>
			<Dialog.Trigger asChild>
				<button
					type="button"
					className="weekly-card weekly-card-trigger sketch"
					aria-label={`${currentLabel} ${hours(current)}. Show last 4 weeks`}
				>
					<span className="weekly-card-heading">
						<span>
							{currentLabel} <strong>{hours(current)}</strong>
						</span>
						<ChevronRight size={18} aria-hidden="true" />
					</span>
					<WeekBar
						week={current}
						label={
							currentLabel === "This week"
								? "This week's study hours"
								: `${currentLabel} study hours`
						}
					/>
				</button>
			</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Overlay className="dialog-overlay" />
				<Dialog.Content className="dialog-content weekly-history sketch sketch-draw">
					<Dialog.Title>Last 4 weeks</Dialog.Title>
					<Dialog.Description>
						Hours done against planned, Monday to Sunday.
					</Dialog.Description>
					<ul className="weekly-history-list">
						{weeks.map((week, index) => {
							const range = `${formatDate(week.startDate, { day: "numeric", month: "short" }, "en-GB")} – ${formatDate(week.endDate, { day: "numeric", month: "short", year: "numeric" }, "en-GB")}`;
							return (
								<li key={week.startDate}>
									<div className="weekly-card-heading">
										<h3>
											{index === 0 && current.startDate === weekStart(today)
												? "This week"
												: "Week of"}{" "}
											{range}
										</h3>
										<span>{hours(week)}</span>
									</div>
									<WeekBar week={week} label={range} />
								</li>
							);
						})}
					</ul>
					<div className="dialog-actions">
						<Dialog.Close asChild>
							<Button variant="outline">Back</Button>
						</Dialog.Close>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
