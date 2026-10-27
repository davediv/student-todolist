/** Shared SVG filter that gives every drawn frame its slight hand wobble. */
export function SketchDefs() {
	return (
		<svg className="sketch-defs" aria-hidden="true" focusable="false">
			<filter
				id="sketch-wobble"
				x="-2%"
				y="-2%"
				width="104%"
				height="104%"
				colorInterpolationFilters="sRGB"
			>
				<feTurbulence
					type="fractalNoise"
					baseFrequency="0.03"
					numOctaves="2"
					seed="11"
					result="noise"
				/>
				<feDisplacementMap
					in="SourceGraphic"
					in2="noise"
					scale="2"
					xChannelSelector="R"
					yChannelSelector="G"
				/>
			</filter>
		</svg>
	);
}
