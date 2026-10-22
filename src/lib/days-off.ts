import { z } from "zod";

export function dayOffSchema(today: string) {
	return z.object({
		date: z.iso
			.date()
			.refine((date) => date >= today, "Choose today or a later date"),
		limitMinutes: z.number().int().min(0).max(720).multipleOf(30),
	});
}
export type DayOffInput = z.infer<ReturnType<typeof dayOffSchema>>;
