import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	redirect,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { LimitsEditor } from "#/components/limits/limits-editor";
import { defaultLimits } from "#/lib/limits";
import { limitsQueryOptions, saveLimits } from "#/lib/limits-query";
import { sessionQueryOptions } from "#/lib/session";
export const Route = createFileRoute("/welcome")({
	ssr: false,
	beforeLoad: async ({ context }) => {
		if (!(await context.queryClient.fetchQuery(sessionQueryOptions)))
			throw redirect({ to: "/sign-in" });
		if (await context.queryClient.fetchQuery(limitsQueryOptions))
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
			<p className="eyebrow">A rhythm that works for you</p>
			<h1>Welcome to Student Todo</h1>
			<p className="page-description">
				How much time can you make for studying each day? You can change this in
				Settings.
			</p>
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
		</main>
	);
}
