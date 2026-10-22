import type { ReactNode } from "react";
export function EmptyState({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children?: ReactNode;
}) {
	return (
		<section className="empty-state">
			<div className="empty-symbol" aria-hidden="true">
				✓
			</div>
			<h3>{title}</h3>
			<p>{description}</p>
			{children}
		</section>
	);
}
