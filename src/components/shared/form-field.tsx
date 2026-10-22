import type { ReactNode } from "react";
import { Label } from "#/components/ui/label";
export function FormField({
	id,
	label,
	error,
	children,
}: {
	id: string;
	label: string;
	error?: string;
	children: (props: {
		id: string;
		"aria-invalid": boolean;
		"aria-describedby"?: string;
	}) => ReactNode;
}) {
	return (
		<div className="form-field">
			<Label htmlFor={id}>{label}</Label>
			{children({
				id,
				"aria-invalid": !!error,
				"aria-describedby": error ? `${id}-error` : undefined,
			})}
			{error && (
				<p id={`${id}-error`} className="field-error" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
