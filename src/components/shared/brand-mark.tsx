/** A drawn box, a scrawled tick that overshoots it, and one highlighter swipe. */
export function BrandMark() {
	return (
		<svg
			className="brand-mark"
			viewBox="0 0 40 40"
			aria-hidden="true"
			focusable="false"
		>
			<path className="brand-mark-highlight" d="M7 27.2 33.4 24.4" />
			<path d="M7.4 9.4 32.4 8.6M30.9 6.6l.5 26M33.2 31.4 7.8 32M9.4 34 8.8 7.2" />
			<path
				className="brand-mark-tick"
				d="M13.4 20.6c2 1.4 3.7 3.6 5.1 6.3 3.3-7.6 7.8-14.2 15.4-20"
			/>
		</svg>
	);
}
