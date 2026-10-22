import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
	return (
		<main>
			<h1>Student Todo</h1>
		</main>
	);
}
