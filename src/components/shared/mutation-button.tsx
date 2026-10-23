import type { ComponentProps } from "react";
import { Button } from "#/components/ui/button";
import { offlineHint, useOnline } from "#/lib/offline";

/** Only write actions use this; reading, closing and navigating stay available. */
export function MutationButton({
	disabled,
	title,
	...props
}: ComponentProps<typeof Button>) {
	const online = useOnline();
	return (
		<Button
			{...props}
			disabled={disabled || !online}
			title={online ? title : offlineHint}
		/>
	);
}
