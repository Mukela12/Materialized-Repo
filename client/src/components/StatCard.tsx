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

export function StatCard({ title, value, subtitle, icon: Icon, trend }: StatCardProps) {
  return (
    <Card className="relative overflow-visible">
      <CardContent className="p-3.5 sm:p-4 md:p-6">
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium leading-snug text-muted-foreground">{title}</p>
            {/* Fluid size + tabular figures: large on desktop, never wider than
                a phone card, and digits that do not shift as values update. */}
            <p className="text-[clamp(1.5rem,5.5vw,1.875rem)] font-bold leading-tight tracking-tight tabular-nums" data-testid={`stat-${title.toLowerCase().replace(/\s/g, "-")}`}>
              {value}
            </p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 sm:h-10 sm:w-10 sm:rounded-xl">
            <Icon className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
          </div>
        </div>
        {trend && (
          <div className={`mt-3 flex items-center text-xs font-medium ${
            trend.isPositive ? "text-green-500" : "text-red-500"
          }`}>
            <span>{trend.isPositive ? "+" : "-"}{Math.abs(trend.value)}%</span>
            <span className="ml-1 text-muted-foreground">vs last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
