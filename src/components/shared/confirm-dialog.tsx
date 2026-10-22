import { Dialog } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Button } from "#/components/ui/button";
export function ConfirmDialog({
	trigger,
	title,
	description,
	onConfirm,
}: {
	trigger: ReactNode;
	title: string;
	description: string;
	onConfirm: () => void | Promise<void>;
}) {
	const [open, setOpen] = useState(false);
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
		<Dialog.Root open={open} onOpenChange={setOpen}>
			<Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Overlay className="dialog-overlay" />
				<Dialog.Content className="dialog-content" aria-busy={busy}>
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
