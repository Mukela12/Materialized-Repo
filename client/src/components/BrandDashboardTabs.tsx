import { Button } from "@/components/ui/button";
import { BarChart3, Package, Users, TrendingUp, Zap, Target } from "lucide-react";

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
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
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
