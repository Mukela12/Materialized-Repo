import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Badges are tinted tags, not solid blocks: a soft fill of their own colour,
 * a faint edge in the same hue, compact type. Solid fills are reserved for
 * the one thing on screen that must shout (a count on a nav item).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium leading-[1.35] tracking-[0.005em] tabular-nums transition-colors" +
  " focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/10 text-primary dark:border-primary/35 dark:bg-primary/15 dark:text-[hsl(215_80%_72%)]",
        secondary: "border-foreground/[0.07] bg-foreground/[0.06] text-foreground/80",
        destructive: "border-destructive/25 bg-destructive/10 text-destructive",
        outline: "border-foreground/15 bg-transparent text-foreground/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants }
