# Stripe live-mode cutover

Switching Materialized from Stripe test mode to live. Follow it in order —
several steps are only safe because an earlier one has already happened.

Verified against production on **29 Jul 2026**. Re-run the preflight before
starting; if its numbers differ from those quoted here, trust the preflight.

```bash
railway run --service backend -- npx tsx script/preflight-livemode.ts
railway run --service Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx script/preflight-livemode.ts --db'
```

---

## The one thing to understand first

**Stripe test and live are two separate worlds.** Different objects, different
ids, different webhook endpoints, different secrets. Nothing crosses over.

That matters because the dangerous failure here is **not** an error message. It
is silence. Swap the secret key on its own and Stripe starts charging real cards
immediately, while every webhook fails signature verification — so no
subscription is recorded, nobody is granted access, no token is minted, and
nothing in the app or the logs says anything is wrong. Customers pay and receive
nothing, and you find out from them.

Every step below exists to prevent a silent failure of that kind.

---

## Before you touch a key

### 1. Rotate the credentials the April payload could have read

`postcss.config.js` carried an obfuscated payload from 8 Apr to 29 Jul 2026 that
executed on every build, including Vercel and Railway builds where build-time
environment variables are present. Treat everything reachable then as exposed:

- `DATABASE_URL`
- `SESSION_SECRET` (rotating this signs every user out — expected)
- Cloudinary and Resend keys

`ACCESS_CODE` was already rotated on 29 Jul. The Stripe key in that window was a
test key, so its exposure is limited — but you are about to create a live one,
so rotate *before* the live key exists rather than after.

Also scan the Windows machine that produced the April commits. It is the only
known source of the injection, and no code change here protects against it.

### 2. Verify Connect onboarding end to end, in TEST mode

This is the step most likely to be skipped and most likely to hurt.

Affiliate payouts have **never moved money**. Two defects prevented it, both
fixed on 29 Jul but neither verified against real Stripe:

- the onboarding return URL was built from `REPLIT_DOMAINS`, unset on this
  deployment, so it rendered as `https://undefined/affiliate/settings`
- the readiness gate required `charges_enabled`, which is false forever on the
  transfers-only accounts this platform creates

Both fixes are reasoned and unit-tested. Neither is *proven*. Do this now:

1. As a creator, hit **Create payout account**, then **Complete onboarding**
2. Complete Stripe's test onboarding
3. Confirm you land back on `/affiliate/settings` — not an `undefined` host
4. Confirm `users.stripe_connect_onboarded` flips to `true`

Step 4 must happen **via the `account.updated` webhook**, not only the status
poll. That is what proves your webhook endpoint is registered for
*connected-account* events, which is a separate checkbox from platform events
and is invisible until a payout silently never happens.

Then approve one small commission and run **Admin → Run payouts**. A transfer
landing in test mode is the only thing that turns "code complete" into "this
pays people".

> If this step fails, stop. Going live with broken payouts means taking money
> from brands you cannot pass on to creators.

### 3. Decide what happens to the demo data

Production currently holds (preflight, 29 Jul):

| | count | what to do |
|---|---|---|
| `users.stripe_customer_id` | **1** | NULL it — see step 6 |
| `users.stripe_connect_account_id` | 0 | nothing |
| `users.stripe_connect_onboarded` | 0 | nothing |
| `brand_subscriptions` with a Stripe id | 0 | nothing |
| `token_ledger` brand_conversion mints | 0 | nothing |

Far less than a typical cutover. There is also **one** `brand_subscriptions` row
with no Stripe subscription id — the demo brand switched on by hand. It grants
entitlement nobody pays for. Cancel it or keep it deliberately; just decide.

---

## The cutover

### 4. Create the LIVE webhook endpoint — before changing any key

In the Stripe dashboard, **switch to live mode**, then add an endpoint at:

```
https://www.mtrlzd.com/api/webhooks/stripe
```

Subscribe to **all** of these:

```
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
invoice.payment_succeeded
invoice.payment_failed
charge.refunded
charge.dispute.created
transfer.reversed
payout.paid
payout.failed
account.updated
```

Tick **"Listen to events on Connected accounts"** as well as your own account.
`account.updated`, `payout.paid` and `payout.failed` arrive only on the
connected-account stream — miss this and payouts break in exactly the silent way
described above.

Copy the new signing secret. You will set it in step 7, *with* the keys, never
before.

> **API version.** Check the version shown on this new endpoint against your
> existing test endpoint. A new endpoint gets the account's current default,
> which may be newer. The code now reads an invoice's subscription id from every
> known location — legacy `invoice.subscription`, the 2025-03-31.basil
> `invoice.parent.subscription_details.subscription`, and the line item — so a
> version difference should be survivable. Note the version anyway; if renewals
> ever go quiet, it is the first thing to check.

### 5. Take a database snapshot

The next step is destructive SQL with no undo in the application.

### 6. Clear the old mode's Stripe ids

No admin route can do this — `PATCH /api/admin/users/:id` accepts only
`role`, `isAdmin`, `freeAccess` and `commissionRateOverride`. It must be SQL:

```sql
UPDATE users SET stripe_customer_id = NULL WHERE stripe_customer_id IS NOT NULL;
UPDATE users SET stripe_connect_account_id = NULL, stripe_connect_onboarded = false
  WHERE stripe_connect_account_id IS NOT NULL;
```

Why this is not optional:

- **A stale customer id is never repaired.** Both checkout and the billing
  portal do `if (!customerId) { create }` — a truthy dead value passes that
  guard and is reused forever, so those routes 500 for that user permanently.
- **A stale connect id is a hard lock.** `POST /api/stripe/connect/create`
  returns the stored id on presence alone, without calling Stripe. There is no
  path *in the app* to ever mint a live account for that user.

Run it against the live database:

```bash
railway run --service Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" psql -c "UPDATE users SET stripe_customer_id = NULL WHERE stripe_customer_id IS NOT NULL;"'
```

Then re-run the DB preflight and confirm every line reads `0`.

> **If `token_ledger` brand_conversion mints is ever non-zero**, delete those
> rows first. The unique index is keyed on `source_brand_id` alone and is
> deliberately not scoped by mode, so a brand that minted in test can never mint
> in live — a real $49 permanently denied to the creator who introduced them.
> Today it is 0, so this does not apply.

### 7. Set all three keys in ONE update, then force a redeploy

```bash
railway variables --service backend \
  --set "STRIPE_SECRET_KEY=sk_live_..." \
  --set "STRIPE_PUBLISHABLE_KEY=pk_live_..." \
  --set "STRIPE_WEBHOOK_SECRET=whsec_..."
```

Never one at a time. A live key paired with the old test webhook secret means
every event fails signature verification, and only one secret is supported.

Two things make a **full restart** mandatory, not optional:

- credentials are cached in module scope in `server/stripeClient.ts` and never
  invalidated, despite the function being named `getUncachableStripeClient`
- `PLATFORM_CURRENCY` is baked into the price-matching logic

On boot the server now logs `[Stripe] LIVE MODE — real money`, and **refuses to
start** if the secret and publishable keys are from different modes. Check the
deploy log for that line before continuing.

### 8. Warm the live price catalogue

```bash
railway run --service backend -- npx tsx script/preflight-livemode.ts
```

Prices and products are created on demand and are per-mode, so the live account
starts empty. This creates them under your control rather than under the first
real customer's checkout. Confirm the mode line reads **LIVE** and all four
prices resolve.

---

## Prove it works, with real money

### 9. One real subscription, then refund it

Use your own card. Complete the intro-offer checkout and confirm:

- $29.00 charged today, then $149.00/month, 30 days free
- `brand_subscriptions` gains a row with a real `stripe_subscription_id`
- the card appears as the customer's **default payment method** — this is what
  later overage charges bill against, and Checkout does not set it by itself;
  `handleCheckoutCompleted` promotes it

`checkout.session.completed` succeeding is **not** sufficient. It has a
`metadata.userId` fallback no other handler has, so it can succeed while the
customer-id lookup every other handler depends on is broken. Wait for the first
`invoice.payment_succeeded` and confirm it also lands.

Then refund, and cancel the subscription.

### 10. One real payout

Approve a small commission, run the payout, confirm it arrives. Note that live
Stripe balances sit pending for days — the platform balance must actually cover
commissions, because sales settle into each brand's own store and never pass
through the platform account.

---

## Known-and-accepted, going in

Not blockers, but do not be surprised by them:

- **Overage is not billed.** The endpoints that charged a browser-computed total
  were removed. The sliders are labelled estimators. Nothing bills usage until
  the overage engine is built.
- **Payouts are manual.** No scheduler exists. An admin runs them; the UI says
  so.
- **Trials are usage-based outside the intro offer**: one video, two minutes.
- **`migrations/` cannot rebuild the database.** The base schema was created by
  `drizzle-kit push`, so 15 of 23 `users` columns are absent from any migration.
  Production is fine; a from-scratch rebuild is not possible from `migrations/`
  alone. This is a disaster-recovery gap, worth fixing, not a launch blocker.
- **No webhook event dedup.** Stripe retries aggressively in live mode. Today's
  handlers are idempotent by construction — token mints are protected by partial
  unique indexes, subscription writes are upserts, payouts carry idempotency
  keys — so this is survivable now. It becomes **required** before usage billing,
  which will not be naturally idempotent.
- **Connect accounts inherit the platform's country.** `createConnectAccount`
  passes no `country`, so creators outside it may not be onboardable at all. If
  the ad reaches an international audience, some creators cannot be paid.

---

## If something goes wrong

Set the three Stripe variables back to their test values in one update and
redeploy. The app returns to test mode immediately.

What does **not** roll back: real charges (refund them in Stripe), and the
nulled ids from step 6 (harmless — they are recreated on demand).

Rolling back does not undo a live Connect account. If a creator onboarded, that
account persists; clear their `stripe_connect_account_id` if you return to test
mode, or they will be locked to an account the test key cannot see.
