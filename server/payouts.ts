/**
 * Affiliate payout execution.
 *
 * Approved commission ledger rows are batched per affiliate and paid out as a
 * single Stripe Connect transfer to their connected account. Money is handled in
 * integer cents; balances below the Stripe minimum are held until they clear.
 *
 * ── The two ways this used to double-pay, and how both are closed ────────────
 * 1. The transfer was keyed on the payout row id, which is minted fresh on every
 *    run. A retry therefore presented a NEW idempotency key and Stripe genuinely
 *    sent the money a second time. The key is now derived from the commission
 *    set being settled (idempotencyKeyFor), so retrying the same debt replays
 *    the same key and Stripe returns the original transfer.
 * 2. A bookkeeping failure AFTER a successful transfer marked the payout
 *    "failed" and left the commissions approved — so the next run paid them
 *    again, on top of money that had already landed. Post-transfer failures now
 *    record the transfer id, mark the payout paid, and report the row under
 *    `needsReconciliation` for a human. `failed` now means, and only means,
 *    that no money moved.
 *
 * Callers that run this unattended MUST hold a lock — see server/scheduler.ts.
 * Two overlapping runs would each plan the same approved commissions.
 *
 * planPayouts() is pure (unit-tested). executePayouts() takes injected deps so the
 * orchestration is testable without a live DB or Stripe.
 */
import { createHash } from "crypto";
import { toCents } from "./feeConfig";
import { MIN_PAYOUT_CENTS } from "../shared/pricing";

/**
 * Stripe's minimum transfer is $0.50. Defined in shared/pricing.ts because the
 * publisher settings page has to quote the same number — it previously said
 * "$50.00", a hundredfold overstatement, because it held its own copy.
 */
export const DEFAULT_MIN_TRANSFER_CENTS = MIN_PAYOUT_CENTS;

/**
 * Marks a payable id as coming from creator_bonuses rather than
 * commission_transactions.
 *
 * Both tables use uuids, so once their rows are in one list a prefix is the
 * only thing telling them apart — and getting that wrong means marking the
 * WRONG table paid, leaving real rows approved to be paid again next run.
 *
 * It lives here, in the engine, rather than in payoutRunner: importing the
 * runner pulls in emailService, and a constant that money-routing depends on
 * should be reachable without dragging half the server in behind it.
 */
export const BONUS_ID_PREFIX = "bonus:";

export interface PayableCommission {
  id: string;
  affiliateId: string;
  commissionAmount: string;
  status: string;
}

export interface PayoutGroup {
  affiliateId: string;
  amountCents: number;
  commissionIds: string[];
}

export interface PayoutPlan {
  payable: PayoutGroup[];
  heldBelowThreshold: PayoutGroup[];
}

/**
 * Group approved commissions by affiliate and sum them in cents. Groups at or
 * above the minimum are payable; the rest are held until they accrue enough.
 */
export function planPayouts(
  commissions: PayableCommission[],
  minTransferCents: number = DEFAULT_MIN_TRANSFER_CENTS,
): PayoutPlan {
  const byAffiliate = new Map<string, PayoutGroup>();
  for (const c of commissions) {
    if (c.status !== "approved") continue;
    const cents = toCents(c.commissionAmount);
    if (cents <= 0) continue;
    let g = byAffiliate.get(c.affiliateId);
    if (!g) {
      g = { affiliateId: c.affiliateId, amountCents: 0, commissionIds: [] };
      byAffiliate.set(c.affiliateId, g);
    }
    g.amountCents += cents;
    g.commissionIds.push(c.id);
  }

  const payable: PayoutGroup[] = [];
  const heldBelowThreshold: PayoutGroup[] = [];
  for (const g of Array.from(byAffiliate.values())) {
    (g.amountCents >= minTransferCents ? payable : heldBelowThreshold).push(g);
  }
  return { payable, heldBelowThreshold };
}

export interface ConnectAccount {
  accountId: string | null;
  onboarded: boolean;
}

export interface PayoutExecDeps {
  getApprovedCommissions(): Promise<PayableCommission[]>;
  getConnectAccount(affiliateId: string): Promise<ConnectAccount>;
  createPayout(affiliateId: string, amountCents: number): Promise<{ id: string }>;
  updatePayoutStatus(payoutId: string, status: string, stripeTransferId?: string): Promise<void>;
  markCommissionsPaid(commissionIds: string[], payoutId: string): Promise<void>;
  transfer(
    amountCents: number,
    destinationAccountId: string,
    idempotencyKey: string,
    metadata: Record<string, string>,
  ): Promise<{ id: string }>;
}

export interface PayoutRunSummary {
  paid: Array<{ affiliateId: string; payoutId: string; amountCents: number; transferId: string }>;
  heldBelowThreshold: Array<{ affiliateId: string; amountCents: number }>;
  skippedNoAccount: Array<{ affiliateId: string; amountCents: number }>;
  failed: Array<{ affiliateId: string; payoutId?: string; amountCents: number; error: string }>;
  /**
   * Money LEFT but the ledger did not record it. Distinct from `failed`, where
   * no money moved — conflating the two is what caused double payment. Every
   * entry here needs a human before the next run.
   */
  needsReconciliation: Array<{
    affiliateId: string; payoutId: string; amountCents: number;
    transferId: string; commissionIds: string[]; error: string;
  }>;
}

/**
 * Idempotency key for a transfer, derived from WHAT IS BEING PAID.
 *
 * Stable across runs: retrying the same debt replays the same key, so Stripe
 * returns the original transfer instead of sending the money a second time.
 * Sorted so that a different ordering of the same commissions cannot produce a
 * different key.
 */
export function idempotencyKeyFor(affiliateId: string, commissionIds: string[]): string {
  const digest = createHash("sha256")
    .update(`${affiliateId}:${[...commissionIds].sort().join(",")}`)
    .digest("hex")
    .slice(0, 40);
  return `payout_${digest}`;
}

/**
 * Plan and execute payouts. For each payable affiliate with an onboarded Connect
 * account: create a pending payout, transfer (idempotent), then mark the
 * commissions paid and the payout paid. Failures mark the payout failed and are
 * reported without aborting the rest of the run.
 */
export async function executePayouts(
  deps: PayoutExecDeps,
  minTransferCents: number = DEFAULT_MIN_TRANSFER_CENTS,
): Promise<PayoutRunSummary> {
  const approved = await deps.getApprovedCommissions();
  const plan = planPayouts(approved, minTransferCents);

  const summary: PayoutRunSummary = {
    paid: [],
    heldBelowThreshold: plan.heldBelowThreshold.map(g => ({ affiliateId: g.affiliateId, amountCents: g.amountCents })),
    skippedNoAccount: [],
    failed: [],
    needsReconciliation: [],
  };

  for (const g of plan.payable) {
    const acct = await deps.getConnectAccount(g.affiliateId);
    if (!acct.accountId || !acct.onboarded) {
      summary.skippedNoAccount.push({ affiliateId: g.affiliateId, amountCents: g.amountCents });
      continue;
    }

    const payout = await deps.createPayout(g.affiliateId, g.amountCents);

    // ── Phase 1: move the money ───────────────────────────────────────────────
    // Anything that throws here means NO money left, so the commissions stay
    // approved and the next run retries them. That is the safe direction.
    let transfer: { id: string };
    try {
      await deps.updatePayoutStatus(payout.id, "processing");
      transfer = await deps.transfer(
        g.amountCents,
        acct.accountId,
        // KEYED ON WHAT IS BEING PAID, NOT ON THIS ROW. It used to be
        // `payout_${payout.id}`, and payout.id is minted fresh on every run — so
        // a retry produced a NEW key and Stripe genuinely sent the money twice.
        // Deriving it from the commission set means a retry of the same debt
        // replays the same key and Stripe returns the original transfer.
        idempotencyKeyFor(g.affiliateId, g.commissionIds),
        { payoutId: payout.id, affiliateId: g.affiliateId },
      );
    } catch (err: any) {
      await deps.updatePayoutStatus(payout.id, "failed").catch(() => {});
      summary.failed.push({
        affiliateId: g.affiliateId,
        payoutId: payout.id,
        amountCents: g.amountCents,
        error: err?.message || "transfer failed",
      });
      continue;
    }

    // ── Phase 2: bookkeeping, AFTER the money has gone ────────────────────────
    // From here the transfer has SUCCEEDED. A failure below must never mark this
    // payout "failed": that is the lie that caused double payment, because the
    // commissions stayed approved and the next run paid them again while the
    // first transfer had already landed.
    try {
      await deps.markCommissionsPaid(g.commissionIds, payout.id);
      await deps.updatePayoutStatus(payout.id, "paid", transfer.id);
      summary.paid.push({
        affiliateId: g.affiliateId, payoutId: payout.id,
        amountCents: g.amountCents, transferId: transfer.id,
      });
    } catch (err: any) {
      // Record the transfer id whatever happens, so the money is traceable and
      // the payout never reads as unpaid.
      await deps.updatePayoutStatus(payout.id, "paid", transfer.id).catch(() => {});
      const message =
        `PAID BUT NOT RECONCILED — transfer ${transfer.id} succeeded for affiliate ` +
        `${g.affiliateId} (payout ${payout.id}), but marking its commissions paid failed: ` +
        `${err?.message || err}. DO NOT re-run blindly; mark commissions ` +
        `${g.commissionIds.join(",")} paid by hand.`;
      summary.needsReconciliation.push({
        affiliateId: g.affiliateId, payoutId: payout.id,
        amountCents: g.amountCents, transferId: transfer.id,
        commissionIds: g.commissionIds, error: err?.message || String(err),
      });
      // Loud: this is the one state a human must act on.
      console.error(`[Payouts] ${message}`);
    }
  }

  return summary;
}
