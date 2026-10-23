import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DayView } from "#/components/plan/day-view";
import { EmptyState } from "#/components/shared/empty-state";
import { SkeletonRows } from "#/components/shared/skeleton";
import { WeeklyCard } from "#/components/stats/weekly-card";
import { Button } from "#/components/ui/button";
import { daysQueryOptions } from "#/lib/days-query";
import { formatDate, localDate } from "#/lib/format";
import { useOnline } from "#/lib/offline";
import { addDays } from "#/lib/planner";

export const Route = createFileRoute("/_app/upcoming")({ component: Upcoming });

function Upcoming() {
	const online = useOnline();
	const today = localDate();
	const query = useQuery(
		daysQueryOptions(addDays(today, 1), addDays(today, 14)),
	);
	const days = query.data?.days ?? [];
	return (
		<>
			<p className="eyebrow">One day at a time</p>
			<h2>Upcoming</h2>
			<p className="page-description">
				A little breathing room for the next two weeks.
			</p>
			<WeeklyCard today={today} />
			{query.isPending && !online ? (
				<EmptyState
					title="No saved upcoming plan"
					description="Connect to load your plan on this device."
				/>
			) : query.isPending ? (
				<SkeletonRows />
			) : query.isError ? (
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
