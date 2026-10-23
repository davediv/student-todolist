import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { FormField } from "#/components/shared/form-field";
import { MutationButton } from "#/components/shared/mutation-button";
import { Input } from "#/components/ui/input";
import {
	defaultLimits,
	limitError,
	type StudyLimits,
	weekdays,
} from "#/lib/limits";
import { useOnline } from "#/lib/offline";
export function LimitsEditor({
	initial,
	onSave,
	welcome = false,
}: {
	initial: StudyLimits;
	onSave: (values: StudyLimits) => Promise<void>;
	welcome?: boolean;
}) {
	const [error, setError] = useState("");
	const online = useOnline();
	const [skipping, setSkipping] = useState(false);
	const form = useForm({
		defaultValues: initial,
		onSubmit: async ({ value }) => {
			setError("");
			try {
				await onSave(value);
			} catch {
				setError("Couldn't save — try again");
			}
		},
	});
	async function skip() {
		setSkipping(true);
		setError("");
		try {
			await onSave(defaultLimits);
		} catch {
			setError("Couldn't save — try again");
		} finally {
			setSkipping(false);
		}
	}
	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="limits-form"
		>
			<div className="limits-grid">
				{weekdays.map((day) => (
					<form.Field
						key={day}
						name={day}
						validators={{
							onChange: ({ value }) => limitError(value),
							onBlur: ({ value }) => limitError(value),
						}}
					>
						{(field) => (
							<FormField
								id={`limit-${day}`}
								label={`${day[0].toUpperCase() + day.slice(1)} (hours)`}
								error={field.state.meta.errors.join(", ")}
							>
								{(props) => (
									<Input
										{...props}
										type="number"
										min={0}
										max={12}
										step={0.5}
										value={
											Number.isFinite(field.state.value)
												? field.state.value / 60
												: ""
										}
										onBlur={field.handleBlur}
										onChange={(event) =>
											field.handleChange(event.target.valueAsNumber * 60)
										}
										disabled={!online}
									/>
								)}
							</FormField>
						)}
					</form.Field>
				))}
			</div>
			{error && (
				<p role="alert" className="field-error">
					{error}
				</p>
			)}
			<form.Subscribe
				selector={(state) => [state.canSubmit, state.isSubmitting]}
			>
				{([canSubmit, busy]) => (
					<div className="form-actions">
						<MutationButton
							type="submit"
							disabled={!canSubmit || busy || skipping}
						>
							{busy ? "Saving…" : "Save"}
						</MutationButton>
						{welcome && (
							<MutationButton
								type="button"
								variant="ghost"
								disabled={busy || skipping}
								onClick={skip}
							>
								{skipping ? "Saving…" : "Skip"}
							</MutationButton>
						)}
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}
