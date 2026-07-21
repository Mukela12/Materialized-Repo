/**
 * Affiliate payout execution.
 *
 * Approved commission ledger rows are batched per affiliate and paid out as a
 * single Stripe Connect transfer to their connected account. Money is handled in
 * integer cents; transfers are idempotent (keyed by payout id) so a retried run
 * never double-pays; balances below the Stripe minimum are held until they clear.
 *
 * planPayouts() is pure (unit-tested). executePayouts() takes injected deps so the
 * orchestration is testable without a live DB or Stripe.
 */
import { toCents } from "./feeConfig";

/** Stripe's minimum transfer is €0.50. */
export const DEFAULT_MIN_TRANSFER_CENTS = 50;

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
  };

  for (const g of plan.payable) {
    const acct = await deps.getConnectAccount(g.affiliateId);
    if (!acct.accountId || !acct.onboarded) {
      summary.skippedNoAccount.push({ affiliateId: g.affiliateId, amountCents: g.amountCents });
      continue;
    }

    // Create the payout first so it has a stable id to key the transfer on.
    const payout = await deps.createPayout(g.affiliateId, g.amountCents);
    try {
      await deps.updatePayoutStatus(payout.id, "processing");
      const transfer = await deps.transfer(g.amountCents, acct.accountId, `payout_${payout.id}`, {
        payoutId: payout.id,
        affiliateId: g.affiliateId,
      });
      await deps.markCommissionsPaid(g.commissionIds, payout.id);
      await deps.updatePayoutStatus(payout.id, "paid", transfer.id);
      summary.paid.push({ affiliateId: g.affiliateId, payoutId: payout.id, amountCents: g.amountCents, transferId: transfer.id });
    } catch (err: any) {
      await deps.updatePayoutStatus(payout.id, "failed").catch(() => {});
      summary.failed.push({
        affiliateId: g.affiliateId,
        payoutId: payout.id,
        amountCents: g.amountCents,
        error: err?.message || "transfer failed",
      });
    }
  }

  return summary;
}
