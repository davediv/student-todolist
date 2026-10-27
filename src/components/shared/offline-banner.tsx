import { offlineHint, useOnline } from "#/lib/offline";

export function OfflineBanner() {
	const online = useOnline();
	if (online) return null;
	return (
		<output className="offline-banner sketch sketch-dashed">
			<strong>Offline</strong> · {offlineHint}
		</output>
	);
}
