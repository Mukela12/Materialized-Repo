import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Buttons as material, not flat fills (recipe from Levy's BUTTONS-V13 and
 * DegreeDesk's canvas.css): a faint top-down sheen, an inner top highlight,
 * and a shadow tinted by the button's own colour. Pressing SINKS the button
 * 1px rather than scaling it. Hover effects exist only on devices that can
 * hover, so a tap never leaves a phone button stuck in its hover state.
 * The brand's pill shape stays; heights came down from ~60px to 40/44px.
 */
const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium tracking-[-0.005em]" +
  " transition-[background-color,border-color,box-shadow,transform,color] duration-150 ease-[cubic-bezier(.22,.7,.26,1)]" +
  " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" +
  " active:translate-y-px disabled:pointer-events-none disabled:opacity-50" +
  " [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-black/15 bg-cta text-cta-foreground" +
          " bg-[linear-gradient(180deg,rgb(255_255_255/0.14),rgb(255_255_255/0)_65%)]" +
          " shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_1px_2px_rgb(0_0_0/0.2),0_8px_18px_-10px_hsl(var(--cta)/0.75)]" +
          " [@media(hover:hover)]:hover:bg-cta-hover active:shadow-[inset_0_1px_3px_rgb(0_0_0/0.28)]",
        destructive:
          // Red text on a light red surface: distinct from primary, not alarming.
          "border border-destructive/25 bg-destructive/10 text-destructive" +
          " [@media(hover:hover)]:hover:bg-destructive/15 [@media(hover:hover)]:hover:border-destructive/40",
        outline:
          "border border-foreground/10 text-foreground" +
          " bg-[linear-gradient(180deg,hsl(var(--card)),hsl(var(--muted)/0.55))]" +
          " shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_2px_rgb(0_0_0/0.12)]" +
          " [@media(hover:hover)]:hover:border-foreground/20 [@media(hover:hover)]:hover:bg-muted",
        secondary:
          "border border-foreground/[0.06] bg-secondary text-secondary-foreground" +
          " shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] [@media(hover:hover)]:hover:bg-secondary/75",
        // A transparent border keeps size stable if a border is toggled on later.
        ghost: "border border-transparent [@media(hover:hover)]:hover:bg-foreground/[0.06]",
      },
      // Heights are MINIMUMS so a button with more content grows instead of clipping.
      size: {
        default: "min-h-10 px-5 py-2",
        sm: "min-h-9 px-4 py-1.5 text-xs",
        lg: "min-h-11 px-6 py-2.5 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
