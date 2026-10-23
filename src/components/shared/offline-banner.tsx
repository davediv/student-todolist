import { offlineHint, useOnline } from "#/lib/offline";

export function OfflineBanner() {
	const online = useOnline();
	if (online) return null;
	return (
		<output className="block rounded-md border bg-muted px-4 py-3 mb-6">
			<strong>Offline</strong> · {offlineHint}
		</output>
	);
}
