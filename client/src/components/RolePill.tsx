import { cn } from "@/lib/utils";

/**
 * The account-type badge (Creator, Brand, Publisher) on the profile card.
 *
 * Ported from Untitled UI's "modern" badge with a dot (MIT,
 * github.com/untitleduico/react, components/base/badges): a white chip with a
 * hairline inset ring and an extra-small shadow, medium-weight text in normal
 * case, and an 8px dot glyph whose colour is the only thing that changes per
 * account type. Sizes are theirs (sm: gap-1, py-0.5, px-1.5, text-xs,
 * rounded-md). In dark mode it sits on the card colour with a faint ring.
 */
const ROLES = {
  creator: { label: "Creator", dot: "text-primary dark:text-[hsl(215_80%_68%)]" },
  brand: { label: "Brand", dot: "text-amber-500" },
  affiliate: { label: "Publisher", dot: "text-emerald-500" },
} as const;

export function RolePill({ role, className }: { role: string | null | undefined; className?: string }) {
  const r = ROLES[role === "brand" || role === "affiliate" ? role : "creator"];
  return (
    <span
      className={cn(
        "flex size-max items-center gap-1 whitespace-nowrap rounded-md py-0.5 pl-1.5 pr-2",
        "text-xs font-medium text-foreground/80",
        "bg-background ring-1 ring-inset ring-border shadow-[0_1px_2px_rgba(10,13,18,0.05)]",
        "dark:bg-card dark:ring-white/10",
        className,
      )}
      data-testid="badge-role"
    >
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden className={r.dot}>
        <circle cx="4" cy="4" r="2.5" fill="currentColor" stroke="currentColor" />
      </svg>
      {r.label}
    </span>
  );
}
