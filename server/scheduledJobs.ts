/**
 * The two scheduled money jobs, and their wiring.
 *
 * Kept apart from server/scheduler.ts so the scheduler stays a pure mechanism
 * with no knowledge of payouts or invoices, and these stay readable as policy.
 *
 * ── Schedules (UTC, overridable by env) ──────────────────────────────────────
 *   publisher-payouts   Mondays 09:00   PAYOUT_CRON
 *   fee-invoices        1st of the month 09:00   FEE_INVOICE_CRON
 *
 * UTC on purpose. A schedule that shifts twice a year with daylight saving pays
 * people on the wrong day, and "9am local" is not worth that.
 *
 * ── Nothing runs unless SCHEDULER_ENABLED=true ───────────────────────────────
 * Automated money movement is switched on once, deliberately, by someone who
 * means it — not acquired as a side effect of a deploy.
 */
import { executePayouts, type PayoutRunSummary } from "./payouts";
import { generateFeeInvoice, type FeeInvoiceStripe } from "./feeInvoicing";
import { getPlatformCurrency } from "./feeConfig";
import type { JobResult, ScheduledJob } from "./scheduler";

export const PAYOUT_JOB = "publisher-payouts";
export const FEE_INVOICE_JOB = "fee-invoices";

export const DEFAULT_PAYOUT_CRON = "0 9 * * 1";   // Mondays 09:00 UTC
export const DEFAULT_FEE_INVOICE_CRON = "0 9 1 * *"; // 1st of the month, 09:00 UTC

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Summarise a payout run for the ledger.
 *
 * `needsReconciliation` is surfaced FIRST and forces a `failed` status even when
 * every transfer succeeded, because it is the one outcome a human must act on:
 * the money left but the ledger did not record it. Reporting that as success is
 * how it would get paid a second time next week.
 */
export function summarisePayoutRun(s: PayoutRunSummary): JobResult {
  const paidCents = s.paid.reduce((t, p) => t + p.amountCents, 0);
  const parts = [
    `${s.paid.length} paid (${money(paidCents)})`,
    `${s.heldBelowThreshold.length} held below minimum`,
    `${s.skippedNoAccount.length} not onboarded`,
    `${s.failed.length} failed`,
  ];

  if (s.needsReconciliation.length) {
    const detail = s.needsReconciliation
      .map((r) => `affiliate ${r.affiliateId} transfer ${r.transferId} (${money(r.amountCents)}): ${r.error}`)
      .join("; ");
    return {
      status: "failed",
      items: s.paid.length,
      detail: `NEEDS RECONCILIATION — money sent but not recorded for ` +
        `${s.needsReconciliation.length} affiliate(s). DO NOT re-run until fixed. ${detail}. ` +
        parts.join(", "),
    };
  }

  if (s.paid.length === 0 && s.failed.length === 0) {
    return { status: "skipped", items: 0, detail: `nothing payable — ${parts.join(", ")}` };
  }
  return {
    status: s.failed.length ? "failed" : "success",
    items: s.paid.length,
    detail: parts.join(", "),
  };
}

export interface PayoutJobDeps {
  runPayouts(): Promise<PayoutRunSummary>;
}

export function makePayoutJob(deps: PayoutJobDeps, cron = process.env.PAYOUT_CRON || DEFAULT_PAYOUT_CRON): ScheduledJob {
  return {
    name: PAYOUT_JOB,
    schedule: cron,
    run: async () => summarisePayoutRun(await deps.runPayouts()),
  };
}

export interface InvoiceJobStore {
  getBrandsWithBillableAccruals(from: Date, to: Date): Promise<Array<{ brandUserId: string; currency: string }>>;
}

/**
 * The window is the PREVIOUS whole calendar month, relative to the occurrence
 * being run — not "the last 30 days from now". Derived from `occurrence` so a
 * catch-up run for a missed 1st bills that month, not the one it woke up in.
 */
export function previousMonthWindow(occurrence: Date): { from: Date; to: Date } {
  const to = new Date(Date.UTC(occurrence.getUTCFullYear(), occurrence.getUTCMonth(), 1));
  const from = new Date(Date.UTC(occurrence.getUTCFullYear(), occurrence.getUTCMonth() - 1, 1));
  return { from, to };
}

export function makeFeeInvoiceJob(
  store: InvoiceJobStore & Parameters<typeof generateFeeInvoice>[0],
  stripe: FeeInvoiceStripe,
  opts: { cron?: string; now?: () => Date } = {},
): ScheduledJob {
  const cron = opts.cron || process.env.FEE_INVOICE_CRON || DEFAULT_FEE_INVOICE_CRON;
  return {
    name: FEE_INVOICE_JOB,
    schedule: cron,
    run: async () => {
      const now = (opts.now ?? (() => new Date()))();
      const { from, to } = previousMonthWindow(now);
      const brands = await store.getBrandsWithBillableAccruals(from, to);

      if (brands.length === 0) {
        return { status: "skipped", items: 0, detail: `no billable accruals for ${from.toISOString().slice(0, 7)}` };
      }

      const results: string[] = [];
      let invoiced = 0;
      let failed = 0;

      for (const b of brands) {
        const r = await generateFeeInvoice(store, stripe, {
          brandUserId: b.brandUserId,
          currency: b.currency,
          periodStart: from,
          periodEnd: to,
          // DRAFTS. The scheduler raises them; a human sends them. An unattended
          // job should not be the thing that first bills a customer.
          finalize: false,
        });
        if (r.status === "invoiced") {
          invoiced++;
          results.push(`${b.brandUserId}: ${money(r.subtotalCents ?? 0)} draft ${r.stripeInvoiceId}`);
        } else if (r.status === "failed") {
          failed++;
          results.push(`${b.brandUserId}: FAILED ${r.error}`);
        } else {
          results.push(`${b.brandUserId}: ${r.status}`);
        }
      }

      return {
        status: failed ? "failed" : invoiced ? "success" : "skipped",
        items: invoiced,
        detail: `${invoiced} draft invoice(s) for ${from.toISOString().slice(0, 7)}` +
          (failed ? `, ${failed} failed` : "") + ` — ${results.join("; ")}`,
      };
    },
  };
}

/** True only when the operator has explicitly turned automation on. */
export function schedulerEnabled(): boolean {
  return String(process.env.SCHEDULER_ENABLED ?? "").toLowerCase() === "true";
}

export { getPlatformCurrency };
