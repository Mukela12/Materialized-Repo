/**
 * One metric. Designed after the professional dashboards (Stripe, Linear,
 * Shopify) rather than the AI-dashboard default it replaced:
 *
 *  - No tinted icon chip. A small monochrome icon sits beside the label, so
 *    the NUMBER is what the eye lands on.
 *  - Captions add information instead of restating the label.
 *  - Zero is shown quietly (muted), so a new account is not greeted by a
 *    wall of loud zeros.
 *  - Inside a .stat-panel on a phone, the first card is the hero and the
 *    rest collapse into label/value rows (see .stat-panel in index.css).
 */
import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

function isZero(value: string | number): boolean {
  if (typeof value === "number") return value === 0;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return String(value).trim() !== "" && Number.isFinite(n) && n === 0;
}

export function StatCard({ title, value, subtitle, icon: Icon, trend }: StatCardProps) {
  const zero = isZero(value);
  return (
    <Card className="stat-card relative overflow-visible">
      <CardContent className="stat-card__body p-4 md:p-5">
        <div className="stat-card__head flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Icon className="stat-card__icon h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2} aria-hidden="true" />
          <p className="stat-card__label truncate text-[12.5px] font-medium">{title}</p>
        </div>
        <p
          className={`stat-card__value mt-2 text-[clamp(1.5rem,5vw,1.875rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums ${zero ? "text-foreground/40" : "text-foreground"}`}
          data-testid={`stat-${title.toLowerCase().replace(/\s/g, "-")}`}
        >
          {value}
        </p>
        <p className="stat-card__meta mt-2 line-clamp-2 text-xs text-muted-foreground">{subtitle}</p>
        {trend && (
          <p className={`stat-card__trend mt-2 text-xs font-medium tabular-nums ${trend.isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {trend.isPositive ? "▲" : "▼"} {Math.abs(trend.value)}%
            <span className="ml-1 font-normal text-muted-foreground">vs last month</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
