import type { CSSProperties } from "react";

/** An hour scale with the ticked part shaded; the figures beside it carry the meaning. */
export function DeadlineMeter({
	tickedMinutes,
	estimateMinutes,
}: {
	tickedMinutes: number;
	estimateMinutes: number;
}) {
	const hours = estimateMinutes / 60;
	const style = {
		"--meter-value": estimateMinutes
			? Math.min(tickedMinutes / estimateMinutes, 1)
			: 0,
		"--meter-units": hours <= 24 ? Math.max(hours, 1) : Math.ceil(hours / 5),
	} as CSSProperties;
	return (
		<span className="meter" aria-hidden="true" style={style}>
			<span className="meter-fill" />
		</span>
	);
}
