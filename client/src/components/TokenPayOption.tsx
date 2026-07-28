/**
 * The one and only "pay with tokens" control.
 *
 * Every $49 surface renders this, so the offer looks and behaves the same in the
 * playlist sheet, the video sheet and the subscription page. Three rules it
 * exists to enforce:
 *
 *   1. The token price and the cash price are ALWAYS shown together — "Use 1
 *      token" next to "$49" — so the user can see what they are giving up.
 *   2. When the balance is short the button is DISABLED WITH THE REASON ON
 *      SCREEN. It is never hidden. A silently missing option looks like a bug and
 *      hides the fact that tokens exist at all.
 *   3. The non-cashable statement travels with the offer, not just the wallet
 *      page. This is a compliance line: a token is account credit and cannot be
 *      withdrawn as money.
 *
 * The balance is read here rather than passed in, so no caller can render a stale
 * one. It gates the BUTTON only — the authoritative check is the DB transaction
 * in server/wallet.ts `spendTokens()`.
 */
import { Button } from "@/components/ui/button";
import { Coins, Loader2, Info, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTokenBalance,
  tokenLabel,
  usdWhole,
  TOKEN_USD,
} from "@/hooks/useWallet";

/**
 * Plain-language, compliance-relevant statement. One constant so the wording is
 * identical everywhere it appears and can be changed in one edit if legal asks.
 */
export const NOT_CASH_STATEMENT =
  "Tokens are account credit, not cash. They can only be spent inside Materialized and cannot be withdrawn, transferred, or paid out to a bank account.";

/** Short form, for tight spaces. Same meaning, no softer. */
export const NOT_CASH_SHORT = "Account credit only — not withdrawable as cash.";

/** The inline notice that sits under a spend offer. */
export function NotCashableNote({ className, short = false }: { className?: string; short?: boolean }) {
  return (
    <p
      className={cn("flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground", className)}
      data-testid="text-not-cashable"
    >
      <Lock className="h-3 w-3 mt-[1px] shrink-0" />
      <span>{short ? NOT_CASH_SHORT : NOT_CASH_STATEMENT}</span>
    </p>
  );
}

/** Small balance chip. Used in headers and next to spend offers. */
export function TokenBalancePill({ className }: { className?: string }) {
  const { balance, isLoading } = useTokenBalance();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary",
        className,
      )}
      data-testid="pill-token-balance"
    >
      <Coins className="h-3 w-3" />
      {isLoading ? "—" : tokenLabel(balance)}
    </span>
  );
}

interface TokenPayOptionProps {
  /** Whole tokens this purchase costs. */
  required: number;
  /** The cash price of the same purchase, in major units, e.g. 49. */
  usdAmount: number;
  /** What is being bought, e.g. "Publish this playlist". */
  title: string;
  /** Optional one-line explanation of how the cost was worked out. */
  breakdown?: string;
  onPay: () => void;
  isPending?: boolean;
  /**
   * A reason unrelated to the balance that blocks the spend (e.g. "Add a billing
   * account first"). Shown instead of the insufficient-balance message.
   */
  blockedReason?: string | null;
  /** Rendered under the token button — typically the card alternative. */
  children?: React.ReactNode;
  testId?: string;
  className?: string;
}

export function TokenPayOption({
  required,
  usdAmount,
  title,
  breakdown,
  onPay,
  isPending = false,
  blockedReason = null,
  children,
  testId = "token-pay",
  className,
}: TokenPayOptionProps) {
  const { balance, isLoading } = useTokenBalance();

  const short = Math.max(0, required - balance);
  // While the balance is loading we do NOT claim the user is short — that would
  // flash a disabled button at someone who has the tokens.
  const insufficient = !isLoading && short > 0;
  const disabled = isPending || isLoading || insufficient || !!blockedReason || required <= 0;

  const reason = blockedReason
    ? blockedReason
    : insufficient
      ? `You have ${tokenLabel(balance)} — this costs ${tokenLabel(required)}. ${short} more needed.`
      : null;

  return (
    <div
      className={cn(
        "rounded-xl border border-primary/25 bg-primary/[0.06] dark:bg-primary/[0.08] p-4 space-y-3",
        className,
      )}
      data-testid={`${testId}-panel`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold text-sm">{title}</span>
        </div>
        <TokenBalancePill />
      </div>

      {/* The whole point of the control: both prices, side by side. */}
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-bold text-lg text-primary" data-testid={`${testId}-cost`}>
          {tokenLabel(required)}
        </span>
        <span className="text-muted-foreground">or</span>
        <span className="font-semibold text-foreground">{usdWhole(usdAmount)}</span>
      </div>

      <p className="text-xs text-muted-foreground">
        {breakdown ?? `1 token = ${usdWhole(TOKEN_USD)} of credit against Materialized fees.`}
      </p>

      <Button
        className="w-full rounded-full gap-2"
        onClick={onPay}
        disabled={disabled}
        aria-disabled={disabled}
        data-testid={`button-${testId}`}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
        {isPending ? "Processing…" : `Use ${tokenLabel(required)}`}
      </Button>

      {/* Never hidden — a disabled option with a stated reason, not a missing one. */}
      {reason && (
        <p
          className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
          data-testid={`${testId}-disabled-reason`}
        >
          <Info className="h-3.5 w-3.5 mt-[1px] shrink-0" />
          <span>{reason}</span>
        </p>
      )}

      {children}

      <NotCashableNote short />
    </div>
  );
}
