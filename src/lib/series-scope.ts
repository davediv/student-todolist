import { z } from "zod";
import { deadlineSchema } from "./deadlines";
import { addDays } from "./planner";

export function seriesScopeSchema(today: string, previousEndDate?: string) {
	const fields = deadlineSchema(today).shape;
	return z
		.object({
			title: fields.title.optional(),
			type: fields.type.optional(),
			notes: z.string().optional(),
			estimateMinutes: fields.estimateMinutes.optional(),
			leadDays: z.number().int().min(1).max(60).optional(),
			endDate: z.iso
				.date()
				.refine(
					(date) =>
						date === previousEndDate ||
						(date > today && date <= addDays(today, 365)),
					"Choose an end date from tomorrow through the next 365 days",
				)
				.optional(),
			previewVersion: z
				.object({
					revision: z.number().int().nonnegative(),
					today: z.iso.date(),
				})
				.optional(),
		})
		.strict();
}
export type SeriesScopeInput = z.input<ReturnType<typeof seriesScopeSchema>>;
