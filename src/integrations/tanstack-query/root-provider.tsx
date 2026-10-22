import { QueryClient } from "@tanstack/react-query";

export function getContext() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { refetchOnWindowFocus: true } },
	});

	return {
		queryClient,
	};
}
export default function TanstackQueryProvider() {}
