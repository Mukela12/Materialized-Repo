/**
 * "Import Influencer Program": the brand's way in to bringing its existing
 * creators across from a CSV (pages/brand-creators.tsx).
 *
 * The import was a tab inside a card on one page, and brands were not finding
 * it. The client (23 Nov 2026): "give this button an accent and animation to
 * get Brands seeing this, like a major prompt to import their file", and put
 * it on the dashboard "next to the Upload Video button", with priority.
 *
 * One component so both places get the same button. The look is .mz-glow-btn
 * in index.css.
 */
import { forwardRef } from "react";
import { FileUp } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Where the import lives, with the CSV tab asked for. */
export const IMPORT_PROGRAM_PATH = "/brand/creators?import=1";

export const ImportProgramButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      className={cn("mz-glow-btn gap-2", className)}
      data-testid="button-import-influencer-program"
      {...props}
    >
      <FileUp aria-hidden="true" />
      {children ?? "Import Influencer Program"}
    </Button>
  ),
);
ImportProgramButton.displayName = "ImportProgramButton";
