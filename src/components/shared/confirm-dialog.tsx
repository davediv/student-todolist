import { Dialog } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Button } from "#/components/ui/button";
export function ConfirmDialog({
	trigger,
	title,
	description,
	onConfirm,
	open: controlledOpen,
	onOpenChange,
	returnFocus,
}: {
	trigger: ReactNode;
	title: string;
	description: string;
	onConfirm: () => void | Promise<void>;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	returnFocus?: () => HTMLElement | null;
}) {
	const [internalOpen, setInternalOpen] = useState(false);
	const open = controlledOpen ?? internalOpen;
	function setOpen(next: boolean) {
		if (controlledOpen === undefined) setInternalOpen(next);
		onOpenChange?.(next);
	}
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	async function confirm() {
		setBusy(true);
		setError("");
		try {
			await onConfirm();
			setOpen(false);
		} catch {
			setError("Something went wrong. Please try again.");
		} finally {
			setBusy(false);
		}
	}
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!busy) setOpen(next);
			}}
		>
			<Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Overlay className="dialog-overlay" />
				<Dialog.Content
					className="dialog-content"
					aria-busy={busy}
					onCloseAutoFocus={
						returnFocus
							? (event) => {
									event.preventDefault();
									returnFocus()?.focus();
								}
							: undefined
					}
				>
					<Dialog.Title>{title}</Dialog.Title>
					<Dialog.Description>{description}</Dialog.Description>
					{error && <p role="alert">{error}</p>}
					<div className="dialog-actions">
						<Dialog.Close asChild>
							<Button variant="outline" disabled={busy}>
								Cancel
							</Button>
						</Dialog.Close>
						<Button variant="destructive" disabled={busy} onClick={confirm}>
							{busy ? "Working…" : "Confirm"}
						</Button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
