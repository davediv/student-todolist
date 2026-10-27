import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import type * as React from "react";

/* Drawn buttons: `sketch` frames them in pencil; the primary gets the highlighter. */
const buttonVariants = cva("btn", {
	variants: {
		variant: {
			default: "sketch btn-primary",
			destructive: "sketch sketch-danger btn-danger",
			outline: "sketch",
			ghost: "btn-ghost",
			link: "btn-link",
		},
		size: {
			default: "",
			lg: "",
			icon: "",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
	},
});

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
