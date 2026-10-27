import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	redirect,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { LimitsEditor } from "#/components/limits/limits-editor";
import { OfflineBanner } from "#/components/shared/offline-banner";
import { defaultLimits } from "#/lib/limits";
import { limitsQueryOptions, saveLimits } from "#/lib/limits-query";
import { isOnline } from "#/lib/offline";
import { sessionQueryOptions } from "#/lib/session";
export const Route = createFileRoute("/welcome")({
	ssr: false,
	beforeLoad: async ({ context }) => {
		if (
			!(isOnline()
				? await context.queryClient.fetchQuery(sessionQueryOptions)
				: context.queryClient.getQueryData(sessionQueryOptions.queryKey))
		)
			throw redirect({ to: "/sign-in" });
		if (
			isOnline()
				? await context.queryClient.fetchQuery(limitsQueryOptions)
				: context.queryClient.getQueryData(limitsQueryOptions.queryKey)
		)
			throw redirect({ to: "/" });
	},
	component: Welcome,
});
function Welcome() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const navigate = useNavigate();
	return (
		<main className="welcome-page">
			<OfflineBanner />
			<p className="eyebrow">A rhythm that works for you</p>
			<h1 className="page-title is-drawn">Welcome to Student Todo</h1>
			<p className="page-description">
				How much time can you make for studying each day? You can change this in
				Settings.
			</p>
			<div className="welcome-sheet sketch sketch-draw">
				<LimitsEditor
					initial={defaultLimits}
					welcome
					onSave={async (values) => {
						const saved = await saveLimits(values);
						queryClient.setQueryData(limitsQueryOptions.queryKey, saved);
						await router.invalidate();
						await navigate({ to: "/" });
					}}
				/>
			</div>
		</main>
	);
}
