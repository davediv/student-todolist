import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { Dialog, DropdownMenu } from "radix-ui";
import { useId, useRef, useState } from "react";
import { MutationButton } from "#/components/shared/mutation-button";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { apiClient } from "#/lib/api-client";
import { localDate } from "#/lib/format";
import { useOnline } from "#/lib/offline";
import { refreshPlan } from "#/lib/plan-cache";
import { addDays } from "#/lib/planner";

type MenuSession = {
	id: string;
	deadlineId: string;
	date: string;
	minutes: number;
	ticked: boolean;
	title?: string;
	dueDate: string;
};
export function SessionMenu({
	session,
	disabled = false,
}: {
	session: MenuSession;
	disabled?: boolean;
}) {
	const client = useQueryClient();
	const online = useOnline();
	const [mode, setMode] = useState<"move" | "duration" | null>(null);
	const [date, setDate] = useState(session.date);
	const [hours, setHours] = useState(String(session.minutes / 60));
	const trigger = useRef<HTMLButtonElement>(null);
	const inputId = useId();
	const today = localDate();
	const lastDay = addDays(session.dueDate, -1);
	const save = useMutation({
		mutationFn: async (
			value: { date: string } | { minutes: number } | "delete",
		) => {
			const route = apiClient.api.sessions[":id"];
			if (value === "delete")
				await route.$delete({ param: { id: session.id } });
			else await route.$patch({ param: { id: session.id }, json: value });
		},
		onSuccess: async () => {
			await refreshPlan(client);
			setMode(null);
		},
	});
	function open(nextMode: "move" | "duration") {
		save.reset();
		setDate(session.date < today ? today : session.date);
		setHours(String(session.minutes / 60));
		setMode(nextMode);
	}
	if (session.ticked) return null;
	return (
		<>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					asChild
					disabled={!online || disabled || save.isPending}
				>
					<MutationButton
						ref={trigger}
						variant="ghost"
						size="icon"
						disabled={disabled || save.isPending}
						aria-label={`Session actions for ${session.title ?? "study session"}`}
					>
						<MoreHorizontal size={18} aria-hidden="true" />
					</MutationButton>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						className="menu-content sketch"
						align="end"
						sideOffset={8}
					>
						<DropdownMenu.Item
							className="menu-item"
							disabled={!online || today > lastDay}
							onSelect={() => open("move")}
						>
							Move to day
						</DropdownMenu.Item>
						<DropdownMenu.Item
							className="menu-item"
							onSelect={() => open("duration")}
							disabled={!online}
						>
							Change duration
						</DropdownMenu.Item>
						<DropdownMenu.Item
							className="menu-item"
							onSelect={() => {
								save.reset();
								save.mutate("delete");
							}}
							disabled={!online}
						>
							Delete
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
			{save.isError && !mode && (
				<p role="alert" className="field-error">
					Couldn't delete session — try again
				</p>
			)}
			<Dialog.Root
				open={mode !== null}
				onOpenChange={(open) => {
					if (!open && !save.isPending) setMode(null);
				}}
			>
				<Dialog.Portal>
					<Dialog.Overlay className="dialog-overlay" />
					<Dialog.Content
						className="dialog-content sketch sketch-draw"
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							trigger.current?.focus();
						}}
					>
						<Dialog.Title>
							{mode === "move" ? "Move to day" : "Change duration"}
						</Dialog.Title>
						<Dialog.Description>
							{session.title ?? "Study session"} · Changes update your study
							plan.
						</Dialog.Description>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								save.mutate(
									mode === "move" ? { date } : { minutes: Number(hours) * 60 },
								);
							}}
						>
							<div className="form-field">
								<label htmlFor={inputId}>
									{mode === "move" ? "Day" : "Duration (hours)"}
								</label>
								{mode === "move" ? (
									<Input
										id={inputId}
										type="date"
										min={today}
										max={lastDay}
										required
										value={date}
										onChange={(event) => setDate(event.target.value)}
										disabled={!online || save.isPending}
									/>
								) : (
									<Input
										id={inputId}
										type="number"
										min={0.5}
										max={12}
										step={0.5}
										required
										value={hours}
										onChange={(event) => setHours(event.target.value)}
										disabled={!online || save.isPending}
									/>
								)}
							</div>
							{save.isError && (
								<p className="field-error" role="alert">
									{save.error.message || "Couldn't update session — try again"}
								</p>
							)}
							<div className="dialog-actions">
								<Button
									type="button"
									variant="outline"
									disabled={save.isPending}
									onClick={() => setMode(null)}
								>
									Cancel
								</Button>
								<MutationButton type="submit" disabled={save.isPending}>
									{save.isPending ? "Saving…" : "Save"}
								</MutationButton>
							</div>
						</form>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}
