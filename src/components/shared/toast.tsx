import { Toast } from "radix-ui";
import { createContext, type ReactNode, useContext, useState } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});
export function useToast() {
	return useContext(ToastContext);
}
export function ToastProvider({ children }: { children: ReactNode }) {
	const [message, setMessage] = useState("");
	const [open, setOpen] = useState(false);
	return (
		<ToastContext.Provider
			value={(text) => {
				setMessage(text);
				setOpen(true);
			}}
		>
			<Toast.Provider swipeDirection="right">
				{children}
				<Toast.Root className="toast" open={open} onOpenChange={setOpen}>
					<Toast.Title>{message}</Toast.Title>
					<Toast.Close aria-label="Dismiss notification">×</Toast.Close>
				</Toast.Root>
				<Toast.Viewport className="toast-viewport" />
			</Toast.Provider>
		</ToastContext.Provider>
	);
}
