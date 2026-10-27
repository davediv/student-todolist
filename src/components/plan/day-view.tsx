import { TriangleAlert } from "lucide-react";
import { TodoRow } from "#/components/todos/todo-row";
import type { PlanDay } from "#/lib/days-query";
import { formatDate, formatHours } from "#/lib/format";
import { SessionRow } from "./session-row";

export function DayView({ day, heading }: { day: PlanDay; heading?: string }) {
	const empty = !day.sessions.length && !day.todos?.length;
	return (
		<section
			className={
				empty ? "day-card sketch sketch-dashed is-empty" : "day-card sketch"
			}
			aria-label={
				heading ??
				formatDate(day.date, { weekday: "long", month: "long", day: "numeric" })
			}
		>
			<div className="day-heading">
				<h3>
					<time dateTime={day.date}>
						{heading ??
							formatDate(day.date, {
								weekday: "long",
								month: "short",
								day: "numeric",
							})}
					</time>
				</h3>
				<p className={day.overLimit ? "day-total over-limit" : "day-total"}>
					{formatHours(day.plannedMinutes)} / {formatHours(day.limitMinutes)}
					{day.overLimit && (
						<span>
							{" "}
							· <TriangleAlert size={16} aria-hidden="true" /> Over limit
						</span>
					)}
				</p>
			</div>
			{day.isDayOff && (
				<p className="day-off">Day off · {formatHours(day.limitMinutes)}</p>
			)}
			{empty ? (
				<p className="day-empty">Nothing planned</p>
			) : (
				<ul className="plan-sessions">
					{day.sessions.map((session) => (
						<SessionRow key={session.id} session={session} />
					))}
					{day.todos?.map((todo) => (
						<TodoRow key={todo.id} todo={todo} />
					))}
				</ul>
			)}
		</section>
	);
}
