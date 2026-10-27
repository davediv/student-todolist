import { Dialog } from "radix-ui";
import { useEffect, useRef } from "react";
import { MutationButton } from "#/components/shared/mutation-button";
import { Button } from "#/components/ui/button";

export type SeriesScope = "this" | "following";

export function ScopeDialog({
	open,
	onOpenChange,
	onSelect,
	action,
	returnFocus,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (scope: SeriesScope) => void;
	action: "edit" | "delete";
	returnFocus: () => HTMLElement | null;
}) {
	const selected = useRef(false);
	useEffect(() => {
		if (open) selected.current = false;
	}, [open]);
	function select(scope: SeriesScope) {
		selected.current = true;
		onSelect(scope);
	}
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="dialog-overlay" />
				<Dialog.Content
					className="dialog-content sketch sketch-draw"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (!selected.current) returnFocus()?.focus();
					}}
				>
					<Dialog.Title>
						{action === "edit"
							? "Edit recurring deadline"
							: "Delete recurring deadline"}
					</Dialog.Title>
					<Dialog.Description>
						Choose which occurrences to {action}. Done occurrences stay
						unchanged when you choose this and following.
					</Dialog.Description>
					<div className="form-actions">
						<MutationButton onClick={() => select("this")}>
							This occurrence
						</MutationButton>
						<MutationButton
							variant="outline"
							onClick={() => select("following")}
						>
							This and following
						</MutationButton>
						<Dialog.Close asChild>
							<Button variant="ghost">Cancel</Button>
						</Dialog.Close>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
