import { useState, useCallback } from "react";
import { X, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CreatorRewardNotificationProps {
  visible?: boolean;
  onDismiss?: () => void;
}

export function CreatorRewardNotification({ visible = true, onDismiss }: CreatorRewardNotificationProps) {
  const [isVisible, setIsVisible] = useState(visible);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  if (!isVisible) return null;

  return (
    <div 
      className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-right-full duration-300"
      data-testid="notification-creator-reward"
    >
      <div 
        className="relative flex items-center gap-4 shadow-xl border border-white/10"
        style={{
          backgroundColor: "#43484D",
          borderRadius: "30px",
          padding: "20px 28px",
        }}
      >
        <div 
          className="flex items-center justify-center w-12 h-12 rounded-full flex-shrink-0"
          style={{ backgroundColor: "#677A67" }}
        >
          <Gift className="w-6 h-6 text-white" />
        </div>
        <div className="pr-8">
          <p className="text-base font-semibold text-white leading-snug">
            Upload Videos, and Earn Rewards every time you Refer a Brand
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="absolute top-3 right-3 h-7 w-7 text-white/60 hover:text-white hover:bg-white/10"
          onClick={dismiss}
          data-testid="button-dismiss-notification"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
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
