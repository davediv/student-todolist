import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "#/components/shared/confirm-dialog";
import { Button } from "#/components/ui/button";
import { refreshPlan } from "#/lib/plan-cache";
import { deleteTodo, type Todo, updateTodo } from "#/lib/todos-query";
import { TodoSheet } from "./todo-sheet";

export function TodoRow({ todo }: { todo: Todo }) {
	const client = useQueryClient();
	const [editing, setEditing] = useState(false);
	const tick = useMutation({
		mutationFn: (done: boolean) => updateTodo(todo.id, { done }),
		onSuccess: () => refreshPlan(client),
	});
	return (
		<li className={`session-row${todo.done ? " is-ticked" : ""}`}>
			<div className="session-main" aria-busy={tick.isPending}>
				<input
					type="checkbox"
					checked={todo.done}
					disabled={tick.isPending}
					aria-label={todo.title}
					onChange={(event) => tick.mutate(event.target.checked)}
				/>
				<span
					className="session-copy session-title"
					style={todo.done ? { textDecoration: "line-through" } : undefined}
				>
					{todo.title}
				</span>
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Edit ${todo.title}`}
					disabled={tick.isPending}
					onClick={() => setEditing(true)}
				>
					<Pencil size={17} aria-hidden="true" />
				</Button>
				<ConfirmDialog
					trigger={
						<Button
							variant="ghost"
							size="icon"
							disabled={tick.isPending}
							aria-label={`Delete ${todo.title}`}
						>
							<Trash2 size={17} aria-hidden="true" />
						</Button>
					}
					title="Delete todo?"
					description={`Delete “${todo.title}”?`}
					onConfirm={async () => {
						await deleteTodo(todo.id);
						await refreshPlan(client);
					}}
				/>
			</div>
			{tick.isError && (
				<p role="alert" className="field-error">
					Couldn't update {todo.title} — try again
				</p>
			)}
			{editing && <TodoSheet todo={todo} onClose={() => setEditing(false)} />}
		</li>
	);
}
