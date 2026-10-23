import { addDays, type CalendarDate } from "./planner";

/** Monday of the supplied calendar date, independent of the machine's timezone. */
export function weekStart(date: CalendarDate): CalendarDate {
	const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
	return addDays(date, -((weekday + 6) % 7));
}

export function recentWeeks(today: CalendarDate) {
	const monday = weekStart(today);
	return Array.from({ length: 4 }, (_, index) => {
		const startDate = addDays(monday, -7 * index);
		return { startDate, endDate: addDays(startDate, 6) };
	});
}
