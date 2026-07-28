/**
 * Token wallet — client data layer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A TOKEN IS ACCOUNT CREDIT, NOT CASH. It cannot be withdrawn, transferred or
 * paid out. See the module doc on server/wallet.ts for the authoritative
 * statement and the cash path (commissions → payouts → Stripe transfers) that
 * the wallet deliberately does not touch.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every wallet surface in the client reads through this file so there is exactly
 * one balance in the UI and one place that invalidates it after a spend. Do not
 * fetch /api/wallet directly from a component.
 *
 * The server owns the truth. The balance below is used to DISABLE a spend button
 * with an explanation before the user clicks — it is never the thing that stops a
 * double-spend. That is `spendTokens()` inside a single DB transaction.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TOKEN_USD, TOKEN_USD_CENTS } from "@shared/pricing";
import { CURRENCY_SYMBOL } from "@/lib/currency";

export { TOKEN_USD, TOKEN_USD_CENTS };

/** Every reason a row can appear in the ledger. Mirrors `tokenLedgerReasonEnum`. */
export type WalletReason =
  | "brand_conversion"
  | "admin_grant"
  | "spend_refund"
  | "spend_library_listing"
  | "spend_playlist"
  | "spend_subscription_credit"
  | "admin_revoke";

/** One append-only ledger row, as returned by GET /api/wallet. */
export interface WalletEntry {
  id: string;
  /** Signed: +N earned, -N spent. */
  deltaTokens: number;
  reason: WalletReason;
  /** Value of ONE token when this row was written — never today's price. */
  usdValueCents: number;
  /** |deltaTokens| × usdValueCents, i.e. what this row was worth on the day. */
  rowUsdCents: number;
  description: string | null;
  attributionMethod: string | null;
  sourceBrandId: string | null;
  attributedVideoId: string | null;
  spendRefType: string | null;
  spendRefId: string | null;
  createdAt: string;
}

/** Derived totals. `balance` is SUM(deltaTokens) — there is no stored counter. */
export interface WalletSummary {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  /** Surviving balance valued FIFO at each token's own grant-time price. */
  balanceUsdCents: number;
  lifetimeEarnedUsdCents: number;
  lifetimeSpentUsdCents: number;
  currentTokenUsdCents: number;
}

export interface WalletResponse extends WalletSummary {
  entries: WalletEntry[];
}

export const WALLET_KEY = ["/api/wallet"] as const;
export const WALLET_SUMMARY_KEY = ["/api/wallet/summary"] as const;

const EMPTY_SUMMARY: WalletSummary = {
  balance: 0,
  lifetimeEarned: 0,
  lifetimeSpent: 0,
  balanceUsdCents: 0,
  lifetimeEarnedUsdCents: 0,
  lifetimeSpentUsdCents: 0,
  currentTokenUsdCents: TOKEN_USD_CENTS,
};

/**
 * A signed-out or non-creator viewer gets `null`, not an error boundary — the
 * spend surfaces are shared with brand/affiliate routes and must degrade to a
 * disabled "0 tokens" state rather than blowing up the page around them.
 */
async function fetchWallet<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Full ledger + totals. Use on the wallet page. */
export function useWallet() {
  return useQuery<WalletResponse | null>({
    queryKey: WALLET_KEY,
    queryFn: () => fetchWallet<WalletResponse>("/api/wallet"),
    staleTime: 15_000,
    retry: false,
  });
}

/** Totals only. Use on spend surfaces and nav badges — no ledger payload. */
export function useWalletSummary() {
  return useQuery<WalletSummary | null>({
    queryKey: WALLET_SUMMARY_KEY,
    queryFn: () => fetchWallet<WalletSummary>("/api/wallet/summary"),
    staleTime: 15_000,
    retry: false,
  });
}

/**
 * Balance plus the loading flag, defaulted so callers never branch on undefined.
 *
 * `isLoading` matters: a spend button must not render as "insufficient" while the
 * balance is still in flight, or a user with tokens sees a disabled button flash.
 */
export function useTokenBalance(): { balance: number; isLoading: boolean; summary: WalletSummary } {
  const { data, isLoading } = useWalletSummary();
  return {
    balance: data?.balance ?? 0,
    isLoading,
    summary: data ?? EMPTY_SUMMARY,
  };
}

/** Call after any successful spend so every surface re-reads the new balance. */
export function useInvalidateWallet() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: WALLET_KEY });
    queryClient.invalidateQueries({ queryKey: WALLET_SUMMARY_KEY });
  };
}

/**
 * POST that returns the parsed body on failure instead of throwing a string.
 *
 * `apiRequest` in lib/queryClient throws `"402: {json}"`, which loses the
 * structured `{ balance, required }` the wallet routes send back. Spend flows
 * need those numbers to say "you have 2 of the 5 tokens this costs".
 */
export async function walletPost<T = any>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T & { error?: string; balance?: number; required?: number } }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    credentials: "include",
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    data = { error: res.statusText };
  }
  return { ok: res.ok, status: res.status, data };
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** "1 token" / "3 tokens". Used verbatim in buttons, so it must read naturally. */
export function tokenLabel(n: number): string {
  return `${n} token${n === 1 ? "" : "s"}`;
}

/** Cents → "$49.00". Ledger rows carry their own historical price, so pass theirs. */
export function centsToMoney(cents: number): string {
  return `${CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;
}

/** Whole-dollar form for prices we know are whole: "$49". */
export function usdWhole(amount: number): string {
  return `${CURRENCY_SYMBOL}${amount}`;
}

/** Human label for a ledger row. */
export function reasonLabel(reason: WalletReason): string {
  switch (reason) {
    case "brand_conversion":         return "Brand subscribed";
    case "admin_grant":              return "Adjustment — credit";
    case "spend_refund":             return "Refund";
    case "spend_library_listing":    return "Global Library listing";
    case "spend_playlist":           return "Playlist published";
    case "spend_subscription_credit":return "Applied to subscription";
    case "admin_revoke":             return "Adjustment — debit";
    default:                         return reason;
  }
}

/** How a `brand_conversion` token was attributed, in words the creator can act on. */
export function attributionLabel(method: string | null): string | null {
  switch (method) {
    case "brand_referral":  return "You referred this brand";
    case "first_touch_tag": return "You were the first creator to tag this brand";
    case "admin_override":  return "Attributed manually by Materialized";
    default:                return null;
  }
}
