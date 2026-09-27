import { useId } from "react";
import { cumulative, hasTrend, sparkPaths } from "@/lib/sparkline";

const W = 240;
const H = 40;

/**
 * Daily values drawn as their running total. Renders nothing unless the
 * DAILY values have a trend (a single sale is not one).
 */
export function Sparkline({ values, label }: { values?: number[]; label: string }) {
  // useId() contains colons, which break url(#...) references.
  const id = `spark${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  if (!values || !hasTrend(values)) return null;
  const { line, area } = sparkPaths(cumulative(values), W, H);
  return (
    <svg
      className="stat-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      data-testid="stat-sparkline"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
          <stop offset="1" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path className="stat-spark__line" d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
