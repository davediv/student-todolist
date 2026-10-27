import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { DaysOffEditor } from "#/components/limits/days-off-editor";
import { LimitsEditor } from "#/components/limits/limits-editor";
import { ConfirmDialog } from "#/components/shared/confirm-dialog";
import { MutationButton } from "#/components/shared/mutation-button";
import { useToast } from "#/components/shared/toast";
import { apiClient } from "#/lib/api-client";
import { authClient } from "#/lib/auth-client";
import { limitsQueryOptions, saveLimits } from "#/lib/limits-query";
import { clearOfflineData } from "#/lib/offline-cache";
export const Route = createFileRoute("/_app/settings")({ component: Settings });
function Settings() {
	const { user } = Route.useRouteContext();
	const { data: limits } = useSuspenseQuery(limitsQueryOptions);
	const toast = useToast();
	const queryClient = useQueryClient();
	const router = useRouter();
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	async function leaveAccount() {
		clearOfflineData(queryClient);
		await navigate({ to: "/sign-in", replace: true });
		await router.invalidate();
	}
	async function deleteAccount() {
		await apiClient.api.account.$delete();
		await leaveAccount();
	}
	async function signOut() {
		setBusy(true);
		setError("");
		try {
			const result = await authClient.signOut();
			if (result.error) throw new Error(result.error.message);
			await leaveAccount();
		} catch {
			setError("Could not sign out. Please try again.");
			setBusy(false);
		}
	}
	return (
		<>
			<p className="eyebrow">Make it yours</p>
			<h2 className="page-title">Settings</h2>
			<p className="page-description">
				Build a study rhythm that fits your week.
			</p>
			<section className="settings-section sketch">
				<h3>Study limits</h3>
				<p className="page-description">
					Hours available each day. Existing sessions stay where they are.
				</p>
				{limits && (
					<LimitsEditor
						initial={limits}
						onSave={async (values) => {
							const saved = await saveLimits(values);
							queryClient.setQueryData(limitsQueryOptions.queryKey, saved);
							toast("Study limits saved");
						}}
					/>
				)}
			</section>
			<DaysOffEditor />
			<section className="account-card sketch">
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
				<div className="account-actions">
					<MutationButton variant="outline" disabled={busy} onClick={signOut}>
						{busy ? "Signing out…" : "Sign out"}
					</MutationButton>
					<ConfirmDialog
						trigger={
							<MutationButton variant="destructive" disabled={busy}>
								Delete account
							</MutationButton>
						}
						title="Delete your account?"
						description="Your account, deadlines, study sessions, recurring series, todos, study limits, days off, and days of use will be permanently deleted from the live database. You'll be signed out."
						onConfirm={deleteAccount}
					/>
				</div>
			</section>
		</>
	);
}
