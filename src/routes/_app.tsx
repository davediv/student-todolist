import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { CalendarDays, CheckCheck, ListTodo, Settings } from "lucide-react";
import { OfflineBanner } from "#/components/shared/offline-banner";
import { ToastProvider } from "#/components/shared/toast";
import { limitsQueryOptions } from "#/lib/limits-query";
import { isOnline } from "#/lib/offline";
import { sessionQueryOptions } from "#/lib/session";

const destinations = [
	{ to: "/", label: "Today", icon: CheckCheck },
	{ to: "/upcoming", label: "Upcoming", icon: CalendarDays },
	{ to: "/deadlines", label: "Deadlines", icon: ListTodo },
	{ to: "/settings", label: "Settings", icon: Settings },
] as const;

export const Route = createFileRoute("/_app")({
	ssr: false,
	beforeLoad: async ({ context }) => {
		const user = isOnline()
			? await context.queryClient.fetchQuery(sessionQueryOptions)
			: context.queryClient.getQueryData(sessionQueryOptions.queryKey);
		if (!user) throw redirect({ to: "/sign-in" });
		const limits = isOnline()
			? await context.queryClient.fetchQuery(limitsQueryOptions)
			: context.queryClient.getQueryData(limitsQueryOptions.queryKey);
		if (!limits) throw redirect({ to: "/welcome" });
		return { user, limits };
	},
	component: AppShell,
});
function AppShell() {
	return (
		<ToastProvider>
			<div className="app-shell">
				<a className="skip-link" href="#main">
					Skip to content
				</a>
				<header className="brand">
					<span className="brand-mark" aria-hidden="true">
						<CheckCheck size={22} />
					</span>
					<h1>Student Todo</h1>
				</header>
				<nav className="app-nav" aria-label="Main navigation">
					{destinations.map(({ to, label, icon: Icon }) => (
						<Link
							key={to}
							to={to}
							activeOptions={{ exact: to === "/" }}
							activeProps={{ "aria-current": "page" }}
						>
							<Icon size={21} aria-hidden="true" />
							<span>{label}</span>
						</Link>
					))}
				</nav>
				<main id="main" tabIndex={-1}>
					<OfflineBanner />
					<Outlet />
				</main>
			</div>
		</ToastProvider>
	);
}
