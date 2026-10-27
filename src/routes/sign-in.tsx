import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import signInSketch from "#/assets/sign-in-sketch.webp";
import { BrandMark } from "#/components/shared/brand-mark";
import { OfflineBanner } from "#/components/shared/offline-banner";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { guestSignInPath } from "#/lib/guest";
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
			<figure className="sign-in-art">
				<img
					src={signInSketch}
					width={1080}
					height={720}
					alt=""
					loading="lazy"
					decoding="async"
				/>
			</figure>
			<div className="crop-marks">
				<div className="cover-sheet sketch sketch-draw">
					<OfflineBanner />
					<BrandMark />
					<h1 className="page-title is-drawn">Student Todo</h1>
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
					{/* The server only accepts the guest account outside production. */}
					{import.meta.env.DEV && (
						<Button asChild variant="outline" size="lg">
							<a href={guestSignInPath}>Continue as guest</a>
						</Button>
					)}
					<p className="title-stamp">
						Invite only<span aria-hidden="true"> · Sheet 1 of 1</span>
					</p>
				</div>
			</div>
		</main>
	);
}
