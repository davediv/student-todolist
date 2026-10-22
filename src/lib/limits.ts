import { z } from "zod";
export const weekdays = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;
export const limitValueSchema = z.number().int().min(0).max(720).multipleOf(30);
export const limitsSchema = z.object({
	monday: limitValueSchema,
	tuesday: limitValueSchema,
	wednesday: limitValueSchema,
	thursday: limitValueSchema,
	friday: limitValueSchema,
	saturday: limitValueSchema,
	sunday: limitValueSchema,
});
export type StudyLimits = z.infer<typeof limitsSchema>;
export const defaultLimits: StudyLimits = {
	monday: 180,
	tuesday: 180,
	wednesday: 180,
	thursday: 180,
	friday: 180,
	saturday: 240,
	sunday: 240,
};
export function limitError(value: number) {
	return limitValueSchema.safeParse(value).success
		? undefined
		: "Choose 0–12 hours in half-hour steps";
}
