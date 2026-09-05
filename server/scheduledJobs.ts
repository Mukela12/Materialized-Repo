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
export const OVERAGE_JOB = "subscription-overage";
// After fee invoices, same morning: the two monthly money jobs stay adjacent in the ledger.
export const DEFAULT_OVERAGE_CRON = "30 9 1 * *";

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

/**
 * How far back a run also sweeps for accruals that were never billed.
 *
 * The window above is one calendar month, so anything the previous run skipped —
 * a brand with no Stripe customer, a Stripe outage, a released claim — fell
 * outside every later window and was never billed at all. Silent, and it grows.
 *
 * The run therefore starts LOOKBACK_MONTHS earlier than the month it is billing.
 * Nothing is billed twice by this: the claim query only ever takes rows still
 * `accrued`, so anything already invoiced is invisible to it.
 */
export const LOOKBACK_MONTHS = 6;

export function billingWindow(occurrence: Date): { from: Date; to: Date } {
  const { to } = previousMonthWindow(occurrence);
  const from = new Date(Date.UTC(
    occurrence.getUTCFullYear(),
    occurrence.getUTCMonth() - 1 - LOOKBACK_MONTHS,
    1,
  ));
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
      // Sweeps back further than the month being billed, so a brand skipped by
      // an earlier run is picked up rather than silently never invoiced.
      const { from, to } = billingWindow(now);
      const brands = await store.getBrandsWithBillableAccruals(from, to);

      if (brands.length === 0) {
        return { status: "skipped", items: 0, detail: `no billable accruals up to ${to.toISOString().slice(0, 7)}` };
      }

      const results: string[] = [];
      let invoiced = 0;
      let failed = 0;
      let noCustomer = 0;

      for (const b of brands) {
        const r = await generateFeeInvoice(store, stripe, {
          brandUserId: b.brandUserId,
          currency: b.currency,
          periodStart: from,
          periodEnd: to,
          // Always drafts — generateFeeInvoice no longer finalises at all.
          // An unattended job must not be the thing that first bills a customer,
          // and finalising is now a separate, explicitly human step.
        });
        if (r.status === "invoiced") {
          invoiced++;
          results.push(`${b.brandUserId}: ${money(r.subtotalCents ?? 0)} draft ${r.stripeInvoiceId}`);
        } else if (r.status === "failed") {
          failed++;
          results.push(`${b.brandUserId}: FAILED ${r.error}`);
        } else if (r.status === "no_customer") {
          // NOT a benign skip. This brand owes money and there is no way to bill
          // them; reported as failure so it surfaces instead of reading as a
          // quiet, healthy run.
          noCustomer++;
          results.push(`${b.brandUserId}: CANNOT BILL — no payment method on file`);
        } else {
          results.push(`${b.brandUserId}: ${r.status}`);
        }
      }

      const unbillable = noCustomer > 0
        ? ` ${noCustomer} brand(s) owe fees but have no payment method on file.`
        : "";

      return {
        status: (failed || noCustomer) ? "failed" : invoiced ? "success" : "skipped",
        items: invoiced,
        detail: `${invoiced} draft invoice(s), billing to ${to.toISOString().slice(0, 7)}` +
          (failed ? `, ${failed} failed` : "") + unbillable + ` — ${results.join("; ")}`,
      };
    },
  };
}

export interface OverageJobStore {
  getPlanAllowances(): Promise<Array<{
    plan: string; includedVideos: number | null; includedViews: number | null;
    overagePerVideoCents: number | null; overagePer1000ViewsCents: number | null;
    billingEnabled: boolean;
  }>>;
  getSubscriptionsForOverage(): Promise<Array<{
    userId: string; plan: string; stripeSubscriptionId: string | null; stripeCustomerId: string | null;
  }>>;
  countVideosInPeriod(creatorId: string, from: Date, to: Date): Promise<number>;
  countBillableViewsInPeriod(creatorId: string, from: Date, to: Date): Promise<number>;
  claimOverageCharge(row: any): Promise<{ id: string } | null>;
  markOverageBilled(id: string, itemId: string): Promise<void>;
  markOverageFailed(id: string, error: string): Promise<void>;
}

export interface OverageStripe {
  createSubscriptionOverageItem(args: {
    customerId: string; subscriptionId: string; amountCents: number;
    currency: string; description: string; idempotencyKey: string;
  }): Promise<{ id: string }>;
}

/**
 * Monthly overage: measure last month, record it, and bill it only where the
 * plan's billing_enabled says so.
 *
 * ── The record/bill split is the safety model ────────────────────────────────
 * billing_enabled defaults false, so a newly configured plan's first month is a
 * DRY RUN: rows land in overage_charges as 'recorded' and the client reviews
 * real numbers in the admin before any card is touched — the same "an
 * unattended job must not be the thing that first bills a customer" rule the
 * fee-invoice job established. Flipping billing_enabled is the deliberate act.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────────
 * claimOverageCharge wins exactly once per (user, month); a catch-up or
 * double-fired run gets null and must not touch Stripe. The Stripe call itself
 * carries an idempotency key derived from the claim, so a crash between claim
 * and mark cannot double-bill either.
 */
export function makeOverageJob(
  store: OverageJobStore,
  stripe: OverageStripe,
  opts: { cron?: string; now?: () => Date } = {},
): ScheduledJob {
  const cron = opts.cron || process.env.OVERAGE_CRON || DEFAULT_OVERAGE_CRON;
  return {
    name: OVERAGE_JOB,
    schedule: cron,
    run: async (): Promise<JobResult> => {
      // Lazy import keeps this file free of a compile-time cycle with overage.ts consumers.
      const { computeOverage, allowanceIsMetered } = await import("./overage");
      const now = (opts.now ?? (() => new Date()))();
      const { from, to } = previousMonthWindow(now);

      const allowances = new Map((await store.getPlanAllowances()).map(a => [a.plan, a]));
      if (allowances.size === 0) {
        return { status: "skipped", items: 0, detail: "no plan allowances configured" };
      }

      const subs = await store.getSubscriptionsForOverage();
      const results: string[] = [];
      let recorded = 0, billed = 0, failed = 0;

      for (const sub of subs) {
        const allowance = allowances.get(sub.plan);
        if (!allowanceIsMetered(allowance)) continue;

        const [videos, views] = await Promise.all([
          store.countVideosInPeriod(sub.userId, from, to),
          store.countBillableViewsInPeriod(sub.userId, from, to),
        ]);
        const o = computeOverage({ videos, views }, allowance!);
        if (o.totalCents <= 0 && o.videosOver === 0 && o.viewsOver === 0) continue;

        const claim = await store.claimOverageCharge({
          userId: sub.userId,
          plan: sub.plan,
          periodStart: from,
          periodEnd: to,
          videosUsed: videos,
          viewsUsed: views,
          includedVideos: allowance!.includedVideos,
          includedViews: allowance!.includedViews,
          videoOverageCents: o.videoOverageCents,
          viewOverageCents: o.viewOverageCents,
          totalCents: o.totalCents,
          currency: getPlatformCurrency(),
          status: "recorded",
        });
        if (!claim) continue; // already handled by an earlier run

        recorded++;

        const billable =
          allowance!.billingEnabled && o.totalCents > 0 &&
          !!sub.stripeSubscriptionId && !!sub.stripeCustomerId;
        if (!billable) {
          results.push(`${sub.userId}: ${money(o.totalCents)} recorded (dry run)`);
          continue;
        }

        try {
          const item = await stripe.createSubscriptionOverageItem({
            customerId: sub.stripeCustomerId!,
            subscriptionId: sub.stripeSubscriptionId!,
            amountCents: o.totalCents,
            currency: getPlatformCurrency(),
            description:
              `Usage overage ${from.toISOString().slice(0, 7)}: ` +
              (o.videosOver ? `${o.videosOver} extra video(s)` : "") +
              (o.videosOver && o.viewsOver ? ", " : "") +
              (o.viewsOver ? `${o.viewsOver} extra views` : ""),
            idempotencyKey: `overage:${claim.id}`,
          });
          await store.markOverageBilled(claim.id, item.id);
          billed++;
          results.push(`${sub.userId}: ${money(o.totalCents)} on next invoice`);
        } catch (err) {
          // The row stays, marked failed, with the reason — money that is owed
          // and unbilled must be a loud line in the ledger, not a silent skip.
          failed++;
          await store.markOverageFailed(claim.id, err instanceof Error ? err.message : String(err));
          results.push(`${sub.userId}: FAILED ${err instanceof Error ? err.message : err}`);
        }
      }

      if (recorded === 0) {
        return { status: "skipped", items: 0, detail: `no overage in ${from.toISOString().slice(0, 7)}` };
      }
      return {
        status: failed ? "failed" : "success",
        items: billed,
        detail: `${recorded} recorded, ${billed} billed, ${failed} failed — ${results.join("; ")}`,
      };
    },
  };
}

/** True only when the operator has explicitly turned automation on. */
export function schedulerEnabled(): boolean {
  return String(process.env.SCHEDULER_ENABLED ?? "").toLowerCase() === "true";
}

export { getPlatformCurrency };
