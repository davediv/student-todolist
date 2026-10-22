import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { DayView } from "#/components/plan/day-view";
import { OverdueStrip } from "#/components/plan/overdue-strip";
import { EmptyState } from "#/components/shared/empty-state";
import { SkeletonRows } from "#/components/shared/skeleton";
import { Button } from "#/components/ui/button";
import { daysQueryOptions } from "#/lib/days-query";
import { formatDate, localDate } from "#/lib/format";
export const Route = createFileRoute("/_app/")({ component: Today });
function Today() {
	const today = localDate();
	const query = useQuery(daysQueryOptions(today, today));
	const day = query.data?.days[0];
	return (
		<>
			<p className="eyebrow">A little progress, every day</p>
			<div className="page-heading">
				<div>
					<h2>Today</h2>
					<p className="page-description">
						<time dateTime={today}>
							{formatDate(today, {
								weekday: "long",
								month: "long",
								day: "numeric",
							})}
						</time>
					</p>
				</div>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger asChild>
						<Button>
							<Plus size={18} aria-hidden="true" /> Add
						</Button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							className="menu-content"
							align="end"
							sideOffset={8}
						>
							<DropdownMenu.Item asChild className="menu-item">
								<Link to="/deadlines" search={{ add: true }}>
									Deadline
								</Link>
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</div>
			<OverdueStrip />
			{query.isPending ? (
				<SkeletonRows />
			) : query.isError ? (
				<div className="plan-error" role="alert">
					<p>Couldn't load your plan — retry</p>
					<Button variant="outline" onClick={() => void query.refetch()}>
						Retry
					</Button>
				</div>
			) : day?.sessions.length ? (
				<DayView day={day} heading="Your study plan" />
			) : (
				<>
					{day && <DayView day={day} heading="Your study plan" />}
					<EmptyState
						title="Nothing planned today"
						description="Add a deadline to make your next study session a little easier."
					/>
				</>
			)}
		</>
	);
}
