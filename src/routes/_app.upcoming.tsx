import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DayView } from "#/components/plan/day-view";
import { EmptyState } from "#/components/shared/empty-state";
import { SavedPlanNotice } from "#/components/shared/saved-plan-notice";
import { SkeletonRows } from "#/components/shared/skeleton";
import { WeeklyCard } from "#/components/stats/weekly-card";
import { Button } from "#/components/ui/button";
import { daysQueryOptions, savedDays } from "#/lib/days-query";
import { formatDate, localDate } from "#/lib/format";
import { useOnline } from "#/lib/offline";
import { addDays } from "#/lib/planner";

export const Route = createFileRoute("/_app/upcoming")({ component: Upcoming });

function Upcoming() {
	const online = useOnline();
	const today = localDate();
	const client = useQueryClient();
	const query = useQuery(
		daysQueryOptions(addDays(today, 1), addDays(today, 14)),
	);
	const saved =
		!online && !query.data
			? savedDays(client, addDays(today, 1), addDays(today, 14))
			: undefined;
	const data = query.data ?? saved;
	const pending = query.isPending && !data;
	const days = data?.days ?? [];
	return (
		<>
			<p className="eyebrow">One day at a time</p>
			<h2>Upcoming</h2>
			<p className="page-description">
				A little breathing room for the next two weeks.
			</p>
			<WeeklyCard today={today} />
			{saved && <SavedPlanNotice days={saved.days} />}
			{pending && !online ? (
				<EmptyState
					title="No saved upcoming plan"
					description="Connect to load your plan on this device."
				/>
			) : pending ? (
				<SkeletonRows />
			) : query.isError && !data ? (
				<div className="plan-error" role="alert">
					<p>Couldn't load your plan — retry</p>
					<Button variant="outline" onClick={() => void query.refetch()}>
						Retry
					</Button>
				</div>
			) : (
				<>
					{days.every(
						(day) => day.sessions.length === 0 && !day.todos?.length,
					) && (
						<EmptyState
							title="No study planned in the next 14 days"
							description="Add a deadline to start planning your study time."
						/>
					)}
					<div className="upcoming-days">
						{days.map((day) => (
							<DayView
								key={day.date}
								day={day}
								heading={`${formatDate(day.date, { weekday: "short" }, "en-GB")} ${formatDate(day.date, { day: "numeric", month: "short" }, "en-GB")}`}
							/>
						))}
					</div>
				</>
			)}
		</>
	);
}
