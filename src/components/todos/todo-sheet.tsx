import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { ApiError } from "#/lib/api-client";
import { localDate } from "#/lib/format";
import { refreshPlan } from "#/lib/plan-cache";
import { createTodo, type Todo, updateTodo } from "#/lib/todos-query";

export function TodoSheet({
	todo,
	onClose,
}: {
	todo?: Todo;
	onClose: () => void;
}) {
	const client = useQueryClient();
	const id = useId();
	const [title, setTitle] = useState(todo?.title ?? "");
	const [date, setDate] = useState(todo?.date ?? "");
	const [errors, setErrors] = useState<Record<string, string[] | undefined>>(
		{},
	);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	async function save() {
		const fields: typeof errors = {};
		if (!title.trim()) fields.title = ["Enter a title"];
		else if (title.trim().length > 120)
			fields.title = ["Use at most 120 characters"];
		if (date && date !== todo?.date && date < localDate())
			fields.date = ["Choose today or a later day"];
		setErrors(fields);
		setError("");
		if (Object.keys(fields).length) return;
		setBusy(true);
		try {
			const input = { title: title.trim(), date: date || null };
			if (todo) await updateTodo(todo.id, input);
			else await createTodo(input);
			await refreshPlan(client);
			onClose();
		} catch (error) {
			if (error instanceof ApiError && error.fields) setErrors(error.fields);
			else setError("Couldn't save todo — try again");
		} finally {
			setBusy(false);
		}
	}
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="dialog-overlay" />
				<Dialog.Content className="dialog-content" aria-busy={busy}>
					<Dialog.Title>{todo ? "Edit todo" : "Add a todo"}</Dialog.Title>
					<Dialog.Description>
						A quick task, with a date only if you need one.
					</Dialog.Description>
					<form
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<div className="deadline-fields">
							<div className="form-field">
								<label htmlFor={`${id}-title`}>Title</label>
								<Input
									id={`${id}-title`}
									value={title}
									disabled={busy}
									onChange={(event) => setTitle(event.target.value)}
									aria-invalid={Boolean(errors.title)}
									aria-describedby={
										errors.title ? `${id}-title-error` : undefined
									}
								/>
								{errors.title && (
									<p id={`${id}-title-error`} className="field-error">
										{errors.title.join(", ")}
									</p>
								)}
							</div>
							<div className="form-field">
								<label htmlFor={`${id}-date`}>Date (optional)</label>
								<Input
									id={`${id}-date`}
									type="date"
									min={localDate()}
									value={date}
									disabled={busy}
									onChange={(event) => setDate(event.target.value)}
									aria-invalid={Boolean(errors.date)}
									aria-describedby={
										errors.date ? `${id}-date-error` : undefined
									}
								/>
								{errors.date && (
									<p id={`${id}-date-error`} className="field-error">
										{errors.date.join(", ")}
									</p>
								)}
							</div>
						</div>
						{error && (
							<p className="field-error" role="alert">
								{error}
							</p>
						)}
						<div className="dialog-actions">
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={onClose}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={busy}>
								{busy ? "Saving…" : "Save"}
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
