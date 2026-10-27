import {
	type ErrorComponentProps,
	Link,
	useRouter,
} from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { BrandMark } from "./brand-mark";

export function NotFound() {
	return (
		<main className="route-state">
			<div className="crop-marks">
				<section className="cover-sheet sketch sketch-dashed sketch-draw">
					<BrandMark />
					<h1 className="page-title">Not on the plan</h1>
					<p>This page doesn't exist, or it was rubbed out.</p>
					<Button asChild>
						<Link to="/">Back to Today</Link>
					</Button>
				</section>
			</div>
		</main>
	);
}

export function RouteError({ reset }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<section
			className="plan-error route-error sketch sketch-danger"
			role="alert"
		>
			<h2>Couldn't load this page — try again</h2>
			<div className="form-actions">
				<Button
					onClick={() => {
						reset();
						void router.invalidate();
					}}
				>
					Try again
				</Button>
				<Button variant="ghost" asChild>
					<Link to="/">Back to Today</Link>
				</Button>
			</div>
		</section>
	);
}
