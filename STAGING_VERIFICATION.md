# Staging Verification Runbook — Money Pipeline (PRs #1–#5)

Run this before the launch. It verifies the fee split → verified sale → commission → payout chain end-to-end in **Stripe test mode**. Nothing here should touch live money.

**Env base:** `API=https://backend-production-93717.up.railway.app`
**Auth:** session-cookie based. Log in via the app (or `POST /api/auth/login`) as the relevant account, then reuse that cookie. Below, `-b cookies.txt` assumes you saved the session cookie after login.

---

## Step 0 — Prerequisites (Railway env vars)
- [ ] `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` = **test-mode** keys (`sk_test_…`, `pk_test_…`)
- [ ] `STRIPE_WEBHOOK_SECRET` set (for subscription webhooks)
- [ ] `DATABASE_URL`, `CLOUDINARY_*`, `RESEND_*` present
- [ ] Stripe **Connect enabled** on the account

## Step 1 — Merge the stack (oldest first)
Merge on GitHub in order; each auto-retargets to `main` as the prior merges:
- [ ] #1 marketplace-fee-split → #2 secure-purchase-attribution → #3 inventory-utm-attribution → #4 admin-adjustable-rates → #5 payout-execution
- [ ] Railway auto-deploys `main`; confirm the deploy is green.

## Step 2 — Apply the schema (CRITICAL GATE)
PRs #4 and #5 add columns/a table. Nothing money-related will work until this runs:
```bash
# from the repo with the Railway DATABASE_URL in env:
npm run db:push
```
- [ ] Confirms new objects: `platform_settings` table, `users.commission_rate_override`, `commission_transactions.payout_id`, `affiliate_payouts.stripe_transfer_id`.

---

## Step 3 — Smoke tests

### 3a. Security — public endpoint can't mint commissions (#2)
```bash
curl -s -X POST "$API/api/analytics/events" -H 'Content-Type: application/json' \
  -d '{"videoId":"<realVideoId>","eventType":"purchase","utmCode":"<realUtm>","revenue":"9999"}'
```
- [ ] Returns OK (event recorded) but **no commission_transaction is created** (check the affiliate's `/api/commissions/:id` — unchanged).

### 3b. Fee split — verified sale creates the right split (#1, #2)
Logged in as **brand or admin**:
```bash
curl -s -X POST "$API/api/sales" -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"videoId":"<videoWithPublisherUtm>","revenue":"100.00","utmCode":"<publisherUtm>"}'
```
- [ ] Response `split`: `brandCents 8500, creatorCents 800, publisherCents 200, platformCents 500`.
- [ ] Two `commission_transactions`: creator €8.00, publisher €2.00 (both `pending`).

### 3c. Inventory sync — product URLs + dedup (#3)
- [ ] Connect a Shopify/Woo test store, sync. Products import with a non-null `productUrl`.
- [ ] **Re-sync** → response shows `skipped > 0`, no duplicate products created.

### 3d. Embed UTM pass-through (#3)
- [ ] Open `$API/embed/<videoId>?utm=<code>`; inspect a product card's `href` → contains `utm_source=materialized…&mtrlzd_ref=<code>`.

### 3e. Admin-adjustable rates (#4)
```bash
curl -s "$API/api/admin/settings/fees" -b admin.txt            # → {marketplaceFeePct:15, creatorPct:8, publisherPct:2}
curl -s -X PATCH "$API/api/admin/settings/fees" -b admin.txt -H 'Content-Type: application/json' \
  -d '{"creatorPct":10}'                                        # → creatorPct:10
```
- [ ] A new `/api/sales` of €100 now yields creator €10.00 (confirms settings feed the split).
- [ ] Set a user override: `PATCH /api/admin/users/:id -d '{"commissionRateOverride":"12"}'` → that creator earns 12% on the next sale.
- [ ] Reset creatorPct back to 8 when done.

---

## Step 4 — Payout dry-run (Stripe TEST mode)
This is the piece I couldn't run locally — verify it carefully.
- [ ] Onboard a **test** Connect account for an affiliate (`/api/stripe/connect/*`); complete KYC with Stripe test data so `payouts_enabled`.
- [ ] Approve the affiliate's commissions: `POST /api/admin/commissions/:id/approve` (status → `approved`).
- [ ] Run payouts:
```bash
curl -s -X POST "$API/api/admin/payouts/run" -b admin.txt
```
- [ ] Summary shows the affiliate under `paid` with the right `amountCents`; a Stripe **test transfer** appears in the dashboard.
- [ ] Commissions now `paid` with a `payoutId`; the `affiliate_payouts` row is `paid` with a `stripeTransferId`.
- [ ] **Idempotency:** run the same command again → the already-paid commissions are gone from `approved`, so no second transfer. (If you re-approve + re-run with the same payout id, Stripe returns the original transfer — no double-pay.)
- [ ] **Threshold:** an affiliate with < €0.50 approved appears under `heldBelowThreshold`, no transfer.
- [ ] **No account:** an affiliate without an onboarded account appears under `skippedNoAccount`, no transfer.

---

## Go / No-Go
- [ ] Steps 3a–3e pass → the sale→split→commission chain is correct.
- [ ] Step 4 passes in test mode → payouts move money safely and idempotently.
- [ ] Only then flip Stripe to live keys (after Stripe's account review clears) for the real event.

**If anything fails, capture the request + response and I'll debug/fix it.** The last remaining SOW item — the signed Shopify/Woo order webhook (auto verified-sales) — is intentionally still to build; until then, log real event sales via `POST /api/sales` (reconciled from the store export).
