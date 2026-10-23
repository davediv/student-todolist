import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { DayView } from "#/components/plan/day-view";
import { OverdueStrip } from "#/components/plan/overdue-strip";
import { EmptyState } from "#/components/shared/empty-state";
import { MutationButton } from "#/components/shared/mutation-button";
import { SavedPlanNotice } from "#/components/shared/saved-plan-notice";
import { SkeletonRows } from "#/components/shared/skeleton";
import { TodoRow } from "#/components/todos/todo-row";
import { TodoSheet } from "#/components/todos/todo-sheet";
import { Button } from "#/components/ui/button";
import { daysQueryOptions, savedDays } from "#/lib/days-query";
import { formatDate, localDate } from "#/lib/format";
import { isOnline, useOnline } from "#/lib/offline";
export const Route = createFileRoute("/_app/")({
	loader: ({ context }) => {
		if (!isOnline()) return;
		const today = localDate();
		void context.queryClient.prefetchQuery(daysQueryOptions(today, today));
	},
	component: Today,
});
function Today() {
	const today = localDate();
	const online = useOnline();
	const client = useQueryClient();
	const query = useQuery(daysQueryOptions(today, today));
	const saved =
		!online && !query.data ? savedDays(client, today, today) : undefined;
	const data = query.data ?? saved;
	const pending = query.isPending && !data;
	const day = data?.days[0];
	const anytime = data?.anytime ?? [];
	const [addingTodo, setAddingTodo] = useState(false);
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
					<DropdownMenu.Trigger asChild disabled={!online}>
						<MutationButton>
							<Plus size={18} aria-hidden="true" /> Add
						</MutationButton>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							className="menu-content"
							align="end"
							sideOffset={8}
						>
							<DropdownMenu.Item
								asChild
								className="menu-item"
								disabled={!online}
							>
								<Link to="/deadlines" search={{ add: true }}>
									Deadline
								</Link>
							</DropdownMenu.Item>
							<DropdownMenu.Item
								className="menu-item"
								onSelect={() => setAddingTodo(true)}
								disabled={!online}
							>
								Todo
							</DropdownMenu.Item>
							<DropdownMenu.Item
								asChild
								className="menu-item"
								disabled={!online}
							>
								<Link to="/deadlines" search={{ addSeries: true }}>
									Recurring deadline
								</Link>
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</div>
			<OverdueStrip />
			{saved && <SavedPlanNotice days={saved.days} />}
			{pending && !online ? (
				<EmptyState
					title="No saved plan for today"
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
			) : day &&
				(day.sessions.length || day.todos?.length || anytime.length) ? (
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
			{anytime.length > 0 && (
				<section className="day-card" aria-label="Anytime">
					<h3>Anytime</h3>
					<ul className="plan-sessions">
						{anytime.map((todo) => (
							<TodoRow key={todo.id} todo={todo} />
						))}
					</ul>
				</section>
			)}
			{addingTodo && <TodoSheet onClose={() => setAddingTodo(false)} />}
		</>
	);
}
