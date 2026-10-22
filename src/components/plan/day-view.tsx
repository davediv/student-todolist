import { TriangleAlert } from "lucide-react";
import type { PlanDay } from "#/lib/days-query";
import { formatDate, formatHours } from "#/lib/format";
import { SessionRow } from "./session-row";

export function DayView({ day, heading }: { day: PlanDay; heading?: string }) {
	return (
		<section
			className="day-card"
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
			{day.sessions.length ? (
				<ul className="plan-sessions">
					{day.sessions.map((session) => (
						<SessionRow key={session.id} session={session} />
					))}
				</ul>
			) : (
				<p className="day-empty">Nothing planned</p>
			)}
		</section>
	);
}
