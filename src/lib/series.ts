import { z } from "zod";
import { deadlineSchema } from "./deadlines";
import { addDays } from "./planner";

export function seriesSchema(today: string) {
	const fields = deadlineSchema(today).shape;
	return z.object({
		title: fields.title,
		type: fields.type,
		notes: fields.notes,
		estimateMinutes: fields.estimateMinutes,
		weekdays: z
			.array(z.number().int().min(0).max(6))
			.min(1, "Choose at least one weekday")
			.max(7)
			.transform((days) => [...new Set(days)].sort()),
		leadDays: z
			.number()
			.int()
			.min(1, "Choose 1–60 lead days")
			.max(60, "Choose 1–60 lead days")
			.default(7),
		endDate: z.iso
			.date("Choose an end date")
			.refine(
				(date) => date > today && date <= addDays(today, 365),
				"Choose an end date from tomorrow through the next 365 days",
			),
	});
}
export type SeriesInput = z.input<ReturnType<typeof seriesSchema>>;
export type PreviewVersion = { revision: number; today: string };

/** Enumerate calendar dates, without local-time/DST arithmetic. */
export function generateOccurrences(
	today: string,
	input: { weekdays: readonly number[]; leadDays: number; endDate: string },
) {
	const selected = new Set(input.weekdays);
	const occurrences: { dueDate: string; startDate: string }[] = [];
	for (
		let date = addDays(today, 1);
		date <= input.endDate;
		date = addDays(date, 1)
	) {
		if (selected.has(new Date(`${date}T00:00:00Z`).getUTCDay()))
			occurrences.push({
				dueDate: date,
				startDate: addDays(date, -input.leadDays),
			});
	}
	return occurrences;
}
