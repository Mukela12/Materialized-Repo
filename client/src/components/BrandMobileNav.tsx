import { LayoutDashboard, Package, Users, Bell, Settings } from "lucide-react";
import { FloatingDock } from "./FloatingDock";

export function BrandMobileNav() {
  return (
    <FloatingDock
      home="/brand"
      items={[
        { path: "/brand", label: "Home", icon: LayoutDashboard },
        { path: "/brand/inventory", label: "Inventory", icon: Package },
        { path: "/brand/campaigns", label: "Campaigns", icon: Users },
        { path: "/brand/mailbox", label: "Mailbox", icon: Bell },
      ]}
      overflow={{ path: "/brand/settings", label: "Settings", icon: Settings }}
    />
  );
}
