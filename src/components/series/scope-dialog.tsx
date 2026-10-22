import { Dialog } from "radix-ui";
import { Button } from "#/components/ui/button";

export type SeriesScope = "this" | "following";

export function ScopeDialog({
	open,
	onOpenChange,
	onSelect,
	action,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (scope: SeriesScope) => void;
	action: "edit" | "delete";
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="dialog-overlay" />
				<Dialog.Content className="dialog-content">
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
						<Button onClick={() => onSelect("this")}>This occurrence</Button>
						<Button variant="outline" onClick={() => onSelect("following")}>
							This and following
						</Button>
						<Dialog.Close asChild>
							<Button variant="ghost">Cancel</Button>
						</Dialog.Close>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
