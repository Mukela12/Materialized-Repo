import { useState, useCallback } from "react";
import { Link } from "wouter";
import { X, Gift, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CreatorRewardNotificationProps {
  visible?: boolean;
  onDismiss?: () => void;
}

const DISMISS_KEY = "creator-reward-promo-dismissed";

/**
 * The referral promo. Three fixes from the 2026 UI audit: it reappeared on
 * every visit (dismissal now sticks, per browser); on phones it sat on top of
 * the bottom nav and over page content (it now floats just above the nav,
 * full width); and it was a dead end (tapping it now opens Referrals, which is
 * exactly what it invites you to do).
 */
export function CreatorRewardNotification({ visible = true, onDismiss }: CreatorRewardNotificationProps) {
  const [isVisible, setIsVisible] = useState(() => {
    if (!visible) return false;
    try { return localStorage.getItem(DISMISS_KEY) !== "1"; } catch { return true; }
  });

  const dismiss = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setIsVisible(false);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
    onDismiss?.();
  }, [onDismiss]);

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 animate-in slide-in-from-bottom-4 fade-in duration-300 md:inset-x-auto md:bottom-6 md:right-6 md:max-w-md md:slide-in-from-right-full"
      data-testid="notification-creator-reward"
    >
      <Link
        href="/creator/referrals"
        className="relative flex items-center gap-3 rounded-[24px] border border-white/10 bg-[#43484D] py-3.5 pl-3.5 pr-12 shadow-xl transition-colors hover:bg-[#4b5156] md:gap-4 md:rounded-[30px] md:py-5 md:pl-6"
        data-testid="link-reward-promo"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1351aa] md:h-12 md:w-12">
          <Gift className="h-5 w-5 text-white md:h-6 md:w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-white md:text-base">
            Upload videos, and earn rewards every time you refer a brand
          </p>
          <p className="mt-0.5 flex items-center gap-0.5 text-xs text-white/60">
            See how it works <ChevronRight className="h-3 w-3" />
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 text-white/60 hover:bg-white/10 hover:text-white"
          onClick={dismiss}
          aria-label="Dismiss"
          data-testid="button-dismiss-notification"
        >
          <X className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}

// Legacy export for backward compatibility - deprecated
export function EarningsNotification({ currentEarnings }: { currentEarnings: number }) {
  // This component is deprecated - returning null
  return null;
}

export function useEarningsDemo() {
  const [demoEarnings, setDemoEarnings] = useState(0);

  const triggerEarning = useCallback((amount: number) => {
    setDemoEarnings(amount);
  }, []);

  return { demoEarnings, triggerEarning };
}
