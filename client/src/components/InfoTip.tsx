/**
 * A small (i) that explains one option: opens on hover with a mouse, and on a
 * tap on a phone or tablet, where there is no hover. Asked for by the client on
 * 30 Sep 2026 for Enable/Disable Commerce, so the explanations stop taking up
 * the panel: "Info icon might keep the screen cleaner clearer".
 *
 * A popover rather than a tooltip for the same reason as CsvFormatHint: a
 * tooltip never opens on a touch screen.
 */
import { useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function InfoTip({ label, children, className, testId }: {
  /** What the icon explains, for screen readers ("About Enable commerce"). */
  label: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  // While the mouse is over the icon or the bubble, a click must not close it:
  // hover already opened it, so the click that follows would toggle it shut.
  const hovering = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();

  const hoverIn = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    hovering.current = true;
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverOut = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    hovering.current = false;
    // A short grace period, so moving from the icon onto the bubble keeps it open.
    closeTimer.current = setTimeout(() => { if (!hovering.current) setOpen(false); }, 150);
  };

  return (
    <Popover open={open} onOpenChange={(next) => { if (next || !hovering.current) setOpen(next); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onPointerEnter={hoverIn}
          onPointerLeave={hoverOut}
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground",
            "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          data-testid={testId}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        className="w-[min(16rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed"
        data-testid={testId ? `${testId}-content` : undefined}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
