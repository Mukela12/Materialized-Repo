import { cn } from "@/lib/utils";
import { useProgram } from "@/hooks/useProgram";

/**
 * The account-type badge (Creator, Brand, Publisher) on the profile card, and
 * the Partner badge that sits beside it for an account with a partner deal.
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
  // A partner keeps the account type they joined as and gets this second
  // badge in its own colour (client, 22 Nov 2026).
  partner: { label: "Partner", dot: "text-violet-500" },
} as const;

/** One badge: the white chip with its coloured dot. */
export function DotPill({ label, dot, className, testId }: { label: string; dot: string; className?: string; testId?: string }) {
  return (
    <span
      className={cn(
        "flex size-max items-center gap-1 whitespace-nowrap rounded-md py-0.5 pl-1.5 pr-2",
        "text-xs font-medium text-foreground/80",
        "bg-background ring-1 ring-inset ring-border shadow-[0_1px_2px_rgba(10,13,18,0.05)]",
        "dark:bg-card dark:ring-white/10",
        className,
      )}
      data-testid={testId}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden className={dot}>
        <circle cx="4" cy="4" r="2.5" fill="currentColor" stroke="currentColor" />
      </svg>
      {label}
    </span>
  );
}

/** The badge for an account type as the CRM names it: partner, creator, brand or publisher. */
export function TypePill({ type, className }: { type: "partner" | "creator" | "brand" | "publisher"; className?: string }) {
  const r = ROLES[type === "publisher" ? "affiliate" : type];
  return <DotPill label={r.label} dot={r.dot} className={className} testId={`badge-type-${type}`} />;
}

/**
 * The signed-in account's own badge, with a second "Partner" badge beside it
 * when the account has a partner deal.
 */
export function RolePill({ role, className }: { role: string | null | undefined; className?: string }) {
  const r = ROLES[role === "brand" || role === "affiliate" ? role : "creator"];
  const { data: program } = useProgram();
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <DotPill label={r.label} dot={r.dot} testId="badge-role" />
      {program?.partner && <DotPill label={ROLES.partner.label} dot={ROLES.partner.dot} testId="badge-partner" />}
    </span>
  );
}
