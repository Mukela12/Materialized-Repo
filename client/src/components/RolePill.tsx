import { cn } from "@/lib/utils";

/**
 * The account-type pill (Creator, Brand, Publisher) on the profile card in
 * the sidebar and the phone menu.
 *
 * It was a stock solid badge, the same blue for every account, sitting under
 * the card on the creator sidebar. Now each type has its own quiet tint: a
 * soft fill and a hairline ring in the type's colour, a small dot with a halo,
 * and spaced small capitals, so it reads as a mark of the account rather than
 * a button. Tinted shadow, no gradient, and it holds in dark mode.
 */
const ROLES = {
  creator: { label: "Creator", hue: "258 62%" },
  brand: { label: "Brand", hue: "32 82%" },
  affiliate: { label: "Publisher", hue: "172 58%" },
} as const;

export type PillRole = keyof typeof ROLES;

export function roleOf(role: string | null | undefined): PillRole {
  return role === "brand" || role === "affiliate" ? role : "creator";
}

export function RolePill({ role, className }: { role: string | null | undefined; className?: string }) {
  const r = ROLES[roleOf(role)];
  return (
    <span
      style={{ ["--pill" as string]: r.hue }}
      className={cn(
        "inline-flex h-[22px] w-fit select-none items-center gap-1.5 rounded-full pl-2 pr-2.5",
        "text-[10px] font-semibold uppercase leading-none tracking-[0.12em]",
        "bg-[hsl(var(--pill)_50%/0.08)] text-[hsl(var(--pill)_32%)]",
        "ring-1 ring-inset ring-[hsl(var(--pill)_45%/0.22)]",
        "shadow-[0_1px_2px_hsl(var(--pill)_40%/0.10)]",
        "dark:bg-[hsl(var(--pill)_60%/0.14)] dark:text-[hsl(var(--pill)_80%)] dark:ring-[hsl(var(--pill)_70%/0.28)]",
        className,
      )}
      data-testid="badge-role"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--pill)_50%)] shadow-[0_0_0_2.5px_hsl(var(--pill)_50%/0.18)] dark:bg-[hsl(var(--pill)_68%)]"
      />
      {r.label}
    </span>
  );
}
