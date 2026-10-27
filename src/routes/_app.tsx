import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useLocation,
} from "@tanstack/react-router";
import { CalendarDays, CheckCheck, ListTodo, Settings } from "lucide-react";
import { BrandMark } from "#/components/shared/brand-mark";
import { OfflineBanner } from "#/components/shared/offline-banner";
import { ToastProvider } from "#/components/shared/toast";
import { formatDate, localDate } from "#/lib/format";
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
	const { user } = Route.useRouteContext();
	const pathname = useLocation({ select: (location) => location.pathname });
	const sheet = destinations.find(({ to }) =>
		to === "/" ? pathname === "/" : pathname.startsWith(to),
	);
	return (
		<ToastProvider>
			<div className="app-shell">
				<a className="skip-link" href="#main">
					Skip to content
				</a>
				<header className="brand">
					<BrandMark />
					<h1 className="brand-name">Student Todo</h1>
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
				{/* Drafting title block: decorative, repeats what the page already says. */}
				<div className="title-block" aria-hidden="true">
					<p>
						<span>Sheet</span>
						{sheet?.label}
					</p>
					<p>
						<span>Drawn by</span>
						{user.name.split(" ")[0]}
					</p>
					<p>
						<span>Date</span>
						{formatDate(
							localDate(),
							{ day: "2-digit", month: "2-digit", year: "2-digit" },
							"en-GB",
						)}
					</p>
				</div>
				<main id="main" tabIndex={-1}>
					<OfflineBanner />
					<Outlet />
				</main>
			</div>
		</ToastProvider>
	);
}
