import { LayoutDashboard, ShoppingBag, Video, Bell, Settings } from "lucide-react";
import { FloatingDock } from "./FloatingDock";

export function AffiliateMobileNav() {
  return (
    <FloatingDock
      home="/affiliate"
      items={[
        { path: "/affiliate", label: "Home", icon: LayoutDashboard },
        { path: "/affiliate/library", label: "Library", icon: ShoppingBag },
        { path: "/affiliate/campaigns", label: "Campaigns", icon: Video },
        { path: "/affiliate/mailbox", label: "Mailbox", icon: Bell },
      ]}
      overflow={{ path: "/affiliate/settings", label: "Settings", icon: Settings }}
    />
  );
}
