/**
 * "Nothing here yet", said the same way everywhere, always with a next step.
 *
 * The 2026 UI audit found 27 hand-rolled empty states in 9 different styles,
 * most of which told people what was missing and not what to do about it.
 * A page that is empty is the moment someone is most likely to leave, so
 * every empty state names the one action that fills it.
 */
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EmptyAction {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyAction;
  secondaryAction?: EmptyAction;
  /** "card" stands alone on a page; "inline" sits inside an existing card. */
  variant?: "card" | "inline";
  className?: string;
  "data-testid"?: string;
}

function ActionButton({ action, primary }: { action: EmptyAction; primary: boolean }) {
  const Icon = action.icon;
  const body = (
    <>
      {Icon && <Icon className="h-4 w-4" />}
      {action.label}
    </>
  );
  const props = {
    size: "sm" as const,
    variant: primary ? ("default" as const) : ("ghost" as const),
    className: "w-full sm:w-auto",
  };
  return action.href ? (
    <Button {...props} asChild>
      <Link href={action.href}>{body}</Link>
    </Button>
  ) : (
    <Button {...props} onClick={action.onClick}>{body}</Button>
  );
}

export function EmptyState({
  icon: Icon, title, description, action, secondaryAction,
  variant = "card", className, ...rest
}: EmptyStateProps) {
  const inner = (
    <div className="mx-auto flex max-w-sm flex-col items-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-5 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
          {action && <ActionButton action={action} primary />}
          {secondaryAction && <ActionButton action={secondaryAction} primary={false} />}
        </div>
      )}
    </div>
  );

  return variant === "card" ? (
    <Card className={cn("px-6 py-12 sm:py-16", className)} data-testid={rest["data-testid"]}>{inner}</Card>
  ) : (
    <div className={cn("px-4 py-10", className)} data-testid={rest["data-testid"]}>{inner}</div>
  );
}
