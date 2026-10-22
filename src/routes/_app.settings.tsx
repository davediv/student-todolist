import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
export const Route = createFileRoute("/_app/settings")({ component: Settings });
function Settings() {
	const { user } = Route.useRouteContext();
	const queryClient = useQueryClient();
	const router = useRouter();
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	async function signOut() {
		setBusy(true);
		setError("");
		try {
			const result = await authClient.signOut();
			if (result.error) throw new Error(result.error.message);
			queryClient.clear();
			await router.invalidate();
			await navigate({ to: "/sign-in", replace: true });
		} catch {
			setError("Could not sign out. Please try again.");
			setBusy(false);
		}
	}
	return (
		<>
			<p className="eyebrow">Make it yours</p>
			<h2>Settings</h2>
			<p className="page-description">
				Build a study rhythm that fits your week.
			</p>
			<section className="account-card">
				<h3>Account</h3>
				<div className="account-profile">
					{user.image ? (
						<img
							src={user.image}
							alt=""
							width={48}
							height={48}
							referrerPolicy="no-referrer"
						/>
					) : (
						<span className="avatar" aria-hidden="true">
							{user.name.slice(0, 1).toUpperCase()}
						</span>
					)}
					<div>
						<p className="account-name">{user.name}</p>
						<p className="account-email">{user.email}</p>
					</div>
				</div>
				{error && <p role="alert">{error}</p>}
				<Button variant="outline" disabled={busy} onClick={signOut}>
					{busy ? "Signing out…" : "Sign out"}
				</Button>
			</section>
		</>
	);
}
