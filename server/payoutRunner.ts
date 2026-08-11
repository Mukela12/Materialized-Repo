/**
 * One definition of "run the payouts", used by BOTH the admin button and the
 * scheduler.
 *
 * The deps used to be built inline inside the admin route. Leaving them there
 * and writing a second set for the scheduler would mean two code paths that move
 * money, free to drift apart — and the one that drifts is the unattended one
 * nobody is watching. So both call this.
 */
import { executePayouts, BONUS_ID_PREFIX, type PayoutRunSummary } from "./payouts";
import { storage } from "./storage";
import { stripeService } from "./stripeService";
import { centsToAmount, formatMoney } from "./feeConfig";
import { isEmailConfigured, sendPayoutExecutedEmail } from "./emailService";

export async function runPayouts(): Promise<PayoutRunSummary> {
  const summary = await executePayouts({
    /**
     * Sale commissions AND subscription bonuses, paid by one engine.
     *
     * A creator owed $8 of commission and $12.45 of bonus should receive one
     * $20.45 transfer, not two — Stripe charges per transfer, and two payouts
     * for one period is a support question every month. Batching them together
     * also means the minimum-payout threshold is applied to what the creator is
     * actually owed rather than to each source separately.
     *
     * Bonus ids carry a prefix so markPaid below can route each id back to the
     * table it came from. The engine itself never inspects an id — it groups,
     * sums and hands the list back — so a prefix is enough to keep two tables
     * behind one interface without teaching the engine about either.
     */
    getApprovedCommissions: async () => {
      const commissions = (await storage.getCommissionsByStatus("approved")).map((c) => ({
        id: c.id,
        affiliateId: c.affiliateId,
        commissionAmount: c.commissionAmount,
        status: c.status ?? "approved",
      }));
      const bonuses = (await storage.getCreatorBonusesByStatus("approved")).map((b) => ({
        id: `${BONUS_ID_PREFIX}${b.id}`,
        affiliateId: b.creatorId,
        // The engine reads a decimal string, and the row stores cents.
        commissionAmount: centsToAmount(b.amountCents),
        status: b.status ?? "approved",
      }));
      return [...commissions, ...bonuses];
    },
    getConnectAccount: async (affiliateId) => {
      const u = await storage.getUser(affiliateId);
      return { accountId: u?.stripeConnectAccountId ?? null, onboarded: !!u?.stripeConnectOnboarded };
    },
    createPayout: async (affiliateId, amountCents) =>
      storage.createPayout({ userId: affiliateId, amount: centsToAmount(amountCents), status: "pending" }),
    updatePayoutStatus: async (id, status, stripeTransferId) => {
      await storage.updatePayoutStatus(id, status, stripeTransferId);
    },
    /**
     * Route each id back to its own table.
     *
     * Both marks are guarded to only advance rows still "approved", so a
     * clawback landing mid-run cannot be overwritten into a payment.
     */
    markCommissionsPaid: async (ids, payoutId) => {
      const bonusIds = ids.filter((i) => i.startsWith(BONUS_ID_PREFIX))
        .map((i) => i.slice(BONUS_ID_PREFIX.length));
      const commissionIds = ids.filter((i) => !i.startsWith(BONUS_ID_PREFIX));
      if (commissionIds.length) await storage.markCommissionsPaid(commissionIds, payoutId);
      if (bonusIds.length) await storage.markCreatorBonusesPaid(bonusIds, payoutId);
    },
    transfer: async (amountCents, dest, idempotencyKey, metadata) => {
      const t = await stripeService.createTransferCents(amountCents, dest, idempotencyKey, metadata);
      return { id: t.id };
    },
  });

  // Notify each paid affiliate. Best-effort: an email failure must never turn a
  // completed payout into a failure, or a retry would move the money again.
  if (isEmailConfigured()) {
    for (const p of summary.paid) {
      try {
        const affiliate = await storage.getUser(p.affiliateId);
        if (affiliate?.email) {
          await sendPayoutExecutedEmail({
            affiliateName: affiliate.displayName,
            affiliateEmail: affiliate.email,
            amount: formatMoney(centsToAmount(p.amountCents)),
            transferId: p.transferId,
            payoutId: p.payoutId,
          });
        }
      } catch (emailErr) {
        console.error(`Payout executed email failed for ${p.affiliateId}:`, emailErr);
      }
    }
  }

  return summary;
}
