import { z } from "zod";
export const deadlineTypes = [
	"assignment",
	"exam",
	"project",
	"reading",
	"other",
] as const;
export function deadlineSchema(today: string) {
	return z
		.object({
			title: z
				.string()
				.trim()
				.min(1, "Enter a title")
				.max(120, "Use at most 120 characters"),
			type: z.enum(deadlineTypes),
			dueDate: z.iso
				.date("Enter a due date")
				.refine(
					(value) => !z.iso.date().safeParse(value).success || value > today,
					"Due date must be after today",
				),
			startDate: z.iso.date("Enter a start date"),
			estimateMinutes: z
				.number()
				.int()
				.min(30, "Estimate must be at least 0.5h")
				.max(6000, "Estimate must be at most 100h")
				.multipleOf(30, "Use half-hour steps"),
			notes: z.string().default(""),
		})
		.refine(
			(value) =>
				!z.iso.date().safeParse(value.startDate).success ||
				!z.iso.date().safeParse(value.dueDate).success ||
				value.startDate < value.dueDate,
			{
				path: ["startDate"],
				message: "Start date must be before the due date",
			},
		);
}
export type DeadlineInput = z.input<ReturnType<typeof deadlineSchema>>;
