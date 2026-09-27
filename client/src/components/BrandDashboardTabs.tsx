import { Button } from "@/components/ui/button";
import { BarChart3, Package, Users, TrendingUp, Zap, Target } from "lucide-react";
import { useEffect, useRef } from "react";
import { useScrollEdges, mergeRefs } from "@/hooks/useScrollEdges";

interface BrandDashboardTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: "stats", label: "Stats", icon: BarChart3 },
  { id: "inventory", label: "Product Inventory", icon: Package },
  { id: "creators", label: "Creator Connections", icon: Users },
  { id: "performance", label: "Performance", icon: TrendingUp },
  { id: "quick-actions", label: "Quick Actions", icon: Zap },
  { id: "campaigns", label: "Campaigns", icon: Target },
];

export function BrandDashboardTabs({ activeTab, onTabChange }: BrandDashboardTabsProps) {
  const edges = useScrollEdges<HTMLDivElement>();
  const row = useRef<HTMLDivElement | null>(null);
  const setRow = useRef(mergeRefs(row, edges)).current;

  // Keep the active pill in view however the tab changed (a pill tap, or a
  // link elsewhere on the page such as the hero's "Invite a creator").
  // Scrolls the row only, never the page.
  useEffect(() => {
    const el = row.current;
    const pill = el?.querySelector<HTMLElement>(`[data-testid="tab-brand-${activeTab}"]`);
    if (!el || !pill) return;
    const p = pill.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const target = el.scrollLeft + (p.left - r.left) - (el.clientWidth - p.width) / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [activeTab]);

  return (
    // Bleeds to the screen edge on phones so pills scroll under the gutter;
    // scroll-fade fades whichever side has more, so the row reads as
    // scrollable instead of as cut off.
    <div ref={setRow} className="scroll-fade flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <Button
            key={tab.id}
            variant={isActive ? "default" : "outline"}
            size="sm"
            onClick={() => onTabChange(tab.id)}
            className="rounded-full gap-1.5 whitespace-nowrap flex-shrink-0"
            data-testid={`tab-brand-${tab.id}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </Button>
        );
      })}
    </div>
  );
}
