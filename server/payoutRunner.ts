/**
 * One definition of "run the payouts", used by BOTH the admin button and the
 * scheduler.
 *
 * The deps used to be built inline inside the admin route. Leaving them there
 * and writing a second set for the scheduler would mean two code paths that move
 * money, free to drift apart — and the one that drifts is the unattended one
 * nobody is watching. So both call this.
 */
import { executePayouts, type PayoutRunSummary } from "./payouts";
import { storage } from "./storage";
import { stripeService } from "./stripeService";
import { centsToAmount, formatMoney } from "./feeConfig";
import { isEmailConfigured, sendPayoutExecutedEmail } from "./emailService";

export async function runPayouts(): Promise<PayoutRunSummary> {
  const summary = await executePayouts({
    getApprovedCommissions: async () =>
      (await storage.getCommissionsByStatus("approved")).map((c) => ({
        id: c.id,
        affiliateId: c.affiliateId,
        commissionAmount: c.commissionAmount,
        status: c.status ?? "approved",
      })),
    getConnectAccount: async (affiliateId) => {
      const u = await storage.getUser(affiliateId);
      return { accountId: u?.stripeConnectAccountId ?? null, onboarded: !!u?.stripeConnectOnboarded };
    },
    createPayout: async (affiliateId, amountCents) =>
      storage.createPayout({ userId: affiliateId, amount: centsToAmount(amountCents), status: "pending" }),
    updatePayoutStatus: async (id, status, stripeTransferId) => {
      await storage.updatePayoutStatus(id, status, stripeTransferId);
    },
    markCommissionsPaid: (ids, payoutId) => storage.markCommissionsPaid(ids, payoutId),
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
