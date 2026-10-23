import { createFileRoute, redirect } from "@tanstack/react-router";
import { CheckCheck } from "lucide-react";
import { useState } from "react";
import { OfflineBanner } from "#/components/shared/offline-banner";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { isOnline, useOnline } from "#/lib/offline";
import { sessionQueryOptions } from "#/lib/session";
export const Route = createFileRoute("/sign-in")({
	validateSearch: (search: Record<string, unknown>): { error?: string } => ({
		error: typeof search.error === "string" ? search.error : undefined,
	}),
	ssr: false,
	beforeLoad: async ({ context }) => {
		if (
			isOnline()
				? await context.queryClient.fetchQuery(sessionQueryOptions)
				: context.queryClient.getQueryData(sessionQueryOptions.queryKey)
		)
			throw redirect({ to: "/" });
	},
	component: SignIn,
});
function SignIn() {
	const online = useOnline();
	const { error } = Route.useSearch();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	async function signIn() {
		setBusy(true);
		setFailed(false);
		try {
			const result = await authClient.signIn.social({
				provider: "google",
				callbackURL: "/",
				errorCallbackURL: "/sign-in",
			});
			if (result.error) {
				setFailed(true);
				setBusy(false);
			}
		} catch {
			setFailed(true);
			setBusy(false);
		}
	}
	return (
		<main className="sign-in">
			<div className="sign-in-card">
				<OfflineBanner />
				<span className="brand-mark" aria-hidden="true">
					<CheckCheck size={26} />
				</span>
				<h1>Student Todo</h1>
				<p>Turn deadlines into a little progress every day.</p>
				{(error || failed) && (
					<p className="sign-in-error" role="alert">
						{error?.toLowerCase() === "not_allowlisted" && !failed
							? "This app is invite-only"
							: "Sign-in failed — try again"}
					</p>
				)}
				<Button
					size="lg"
					disabled={busy || !online}
					aria-busy={busy}
					onClick={signIn}
				>
					{busy ? "Connecting to Google…" : "Sign in with Google"}
				</Button>
			</div>
		</main>
	);
}
