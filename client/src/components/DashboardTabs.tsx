import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Link2, Heart, PlayCircle, Zap, TrendingUp } from "lucide-react";

interface DashboardTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: "stats", label: "Stats Overview", icon: BarChart3 },
  { id: "affiliate", label: "Affiliate Links", icon: Link2 },
  // "Charity Support" is hidden until the feature is real. Nothing in the system
  // ever writes users.charity_contribution and no donation is ever made, so the
  // panel claimed money was being given to charity when none had been. See the
  // charity block in pages/dashboard.tsx. Restore this entry when it is built.
  { id: "demo", label: "Video Demo", icon: PlayCircle },
  { id: "actions", label: "Quick Actions", icon: Zap },
  { id: "performance", label: "Performance", icon: TrendingUp },
];

export function DashboardTabs({ activeTab, onTabChange }: DashboardTabsProps) {
  return (
    <div className="w-full overflow-x-auto pb-2 -mb-2 scrollbar-hide">
      <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
        <TabsList className="inline-flex h-12 w-max min-w-full items-center justify-start gap-1 rounded-xl bg-muted/50 p-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm"
                data-testid={`tab-${tab.id}`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </div>
  );
}
