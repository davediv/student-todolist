import type { PlanDay } from "#/lib/days-query";
import { formatDate } from "#/lib/format";

export function SavedPlanNotice({ days }: { days: PlanDay[] }) {
	if (!days.length) return null;
	const first = formatDate(
		days[0].date,
		{
			day: "numeric",
			month: "short",
			year: "numeric",
		},
		"en-GB",
	);
	const last = formatDate(
		days[days.length - 1].date,
		{
			day: "numeric",
			month: "short",
			year: "numeric",
		},
		"en-GB",
	);
	return (
		<p className="page-description">
			Saved plan · {first}
			{first === last ? "" : ` – ${last}`}. Connect to update your plan.
		</p>
	);
}
