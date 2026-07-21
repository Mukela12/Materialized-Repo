# Affiliate / UTM → Attribution → Payout — Audit & Test Checklist

**Purpose:** methodically verify that the affiliate/publisher system correctly (1) tags each repost with a unique UTM, (2) attributes views/clicks/**purchases** to the right affiliate, (3) calculates the right commission, and (4) pays the right person — then hand the client a clean "what's solid / what I fixed / what's needed" report.

**Scope note:** the current source of truth is the **Replit** version (rebrand + newly-added Publisher dashboard). Everything below is written to be run against *that* codebase once pulled. Where I already found something in the **migrated** version I audited, it's marked `[MIGRATED-FINDING]` — treat those as "re-verify, likely still present" because the Replit version shares the same origin code.

**Status legend:** `✅ solid` · `⚠️ fixed by me` · `❌ needs build` · `🔍 not yet checked`

---

## 0. Pre-requisite — pull & map the Replit codebase

You cannot audit the new Publisher attribution blind. First:

- [ ] Get the Replit version as a real repo/export (not screenshots). Confirm it matches what's deployed.
- [ ] Confirm the tables exist: `campaign_affiliates`, `video_license_purchases`, `analytics_events`, `commission_transactions`, `affiliate_payouts`, `embed_deployments`, plus the new publisher tables (`publisher_*` / tier tables).
- [ ] Diff the affiliate/analytics/webhook code against the migrated version so you know what the Agent changed when it added the Publisher dashboard.

**Fast orientation greps (run at repo root):**
```bash
grep -rn "analytics/events\|resolveUtmToAffiliate\|createCommissionTransaction" server/ --include='*.ts'
grep -rn "createTransfer\|transfers.create\|source_transaction" server/ --include='*.ts'
grep -rni "idempot\|webhook.*event\|constructEvent" server/ --include='*.ts'
grep -rni "utm\|referrerDomain\|60.day\|cookie\|attribution.window" server/ --include='*.ts'
grep -rni "orders/create\|orders/paid\|order.created\|woocommerce.*webhook\|shopify.*webhook" server/ --include='*.ts'
```

---

## The chain (what "correct" means end-to-end)

```
1. Generate UTM  →  2. Embed view  →  3. Product click  →  4. Purchase on BRAND store
   (unique/repost)   (attribute)       (carry ref out)      (round-trip back, ≤60 days)
                                                                    │
                     7. Dashboard  ←  6. Payout (Stripe)  ←  5. Commission calc
                        (accurate)      (right person)         (right amount)
```

Break any link and "which affiliate to pay" / "accurate viewing data" is wrong. Audit each link as **code** *and* **runtime test**.

---

## 1. UTM generation & uniqueness

| Check | How to verify | Expected |
|---|---|---|
| Unique code per video **per repost/source** | Read the code-gen path; check for a uniqueness constraint on the UTM column | Two reposts (blog + website) of the same video → **two distinct** codes |
| Multiple codes per publisher supported | Assign one publisher 2+ sources | Each source = its own code, all mapping back to the same publisher |
| Code maps to (affiliate, campaign, video, rate) | Inspect `resolveUtmToAffiliate` return shape | Returns `affiliateId`, `campaignAffiliateId`, `commissionRate` |

**Runtime test:** create a publisher → license/repost a video → generate 2 source codes → confirm both stored, unique, and resolvable.

**Status:** 🔍

---

## 2. Embed view tracking

| Check | How to verify | Expected |
|---|---|---|
| Embed load fires a `view` event with UTM | Load `/embed/:videoId?utm...`; watch network + `analytics_events` | One `view` row, `affiliateId` resolved from UTM |
| Source domain captured | Check `referrerDomain` / `embed_deployments` | Deployment row per (affiliate, video, domain, utm) |
| No double-count on reload / autoplay retry | Reload embed a few times | View count increments sanely, not 3× per load |

**Runtime test:** load the embed from two different codes/domains → expect two correctly-attributed view events; dashboard view count == raw event count.

**Status:** 🔍

---

## 3. Product click & **outbound** attribution

| Check | How to verify | Expected |
|---|---|---|
| Click logs a `click` event with UTM | Click a product in the embed | `click` row attributed to right affiliate |
| Outbound link to brand store **carries the ref** | Inspect the actual href/redirect to Shopify/Woo | URL contains utm/affiliate ref **and a click id** |
| A durable click→affiliate mapping is stored | Look for a persisted click id / cookie with TTL | Row/cookie keyed by click id, **60-day** expiry |

> 🔴 This is the pivot to the hard part. If the outbound click doesn't carry a ref **and** nothing persists a 60-day click→affiliate mapping, purchase attribution *cannot* work except by trusting whatever the client reports later (see §4).

**Status:** 🔍

---

## 4. 🔴 The external-store round-trip (the make-or-break test)

The purchase happens on the **brand's** Shopify/WooCommerce, not on Materialized. For a commission to be real, that purchase must come back attributed, within 60 days. There are only three ways to close this loop — verify which (if any) exists:

1. **Brand-store order webhook** (`orders/create`/`orders/paid` for Shopify, `order.created` for Woo) that includes the ref in order `note_attributes`/metadata, verified by the store's webhook signature.
2. **Materialized tracking pixel/script** on the brand's thank-you/confirmation page that reports the order + click id back.
3. **Manual reconciliation** (not viable for "automatic 30% payout").

| Check | How to verify | Expected |
|---|---|---|
| Is there an **order/purchase** webhook handler from Shopify/Woo? | grep for order webhook topics; check `integrations/` | A signed handler that reads the ref and creates a commission |
| Is the purchase **verified** (signature / server-to-server), not client-reported? | Trace where `eventType:"purchase"` originates | Purchase comes from the **store**, signature-checked |
| Does attribution honour the **60-day window**? | Feed a click aged 0d, 59d, 61d | ≤60d attributes; >60d does **not** |

**Runtime test (do this explicitly):**
- Simulate a real order: send a mock Shopify `orders/create` webhook (or Woo equivalent) carrying the affiliate ref → expect a `commission_transaction` for the **correct** affiliate and **exact** amount.
- Repeat with a click aged within vs. beyond 60 days → expect attribute vs. no-attribute.
- Try to attribute with **no** valid ref → expect **no** commission (not a silent fallback to a default affiliate).

> `[MIGRATED-FINDING]` In the version I audited there was **no order webhook from the brand store**. "Purchases" were reported to the app's own public endpoint (see §4b), i.e. the loop was *not* closed by the store — it trusted client-reported purchases. Re-verify whether the Replit Publisher build added a real store webhook. **If it didn't, this is the #1 build item.**

**Status:** ❌ (assume until proven otherwise)

---

## 4b. 🔴 CRITICAL — can purchases/commissions be **spoofed**?

`[MIGRATED-FINDING]` `POST /api/analytics/events` was **unauthenticated** and did this from **client-supplied** body:

```
{ eventType: "purchase", utmCode: "<any affiliate's code>", revenue: "999999", videoId, productId }
→ resolves utmCode → creates a commission_transaction for that affiliate at revenue*rate
```

It's called from the public embed `widget.js` via `sendBeacon`/`fetch`, so anyone can POST it directly. **Result: any actor can mint commissions for any affiliate at any amount.** This is a fraud/correctness hole *and* the reason the "which affiliate gets paid, from accurate data" guarantee fails.

| Check | How to verify | Expected (target state) |
|---|---|---|
| Is the purchase/commission path authenticated or store-verified? | Read the events route + middleware | `purchase` commissions come **only** from a signature-verified store webhook, never a public POST |
| Is `revenue`/`saleAmount` sourced from the client? | Trace the amount | Amount comes from the **store order**, not the browser |
| Views/clicks vs. purchases separated by trust level | Check route logic | Views/clicks can be public+deduped; **purchases require verification** |

**Runtime test:** `curl -X POST .../api/analytics/events -d '{"eventType":"purchase","utmCode":"REALCODE","revenue":"100000",...}'` → **must not** create a payable commission. If it does, that's a confirmed critical.

**Status:** ❌ (re-verify; assume present)

---

## 5. Commission calculation correctness

| Check | How to verify | Expected |
|---|---|---|
| **Integer-cents math**, not float | Read the calc | Amounts in integer cents; **no** `parseFloat`/`*rate/100`/`toFixed(2)` |
| Rate resolution precedence | Trace `commissionRate` source | **admin per-user/per-video override → publisher tier rate → default 5%/10-15%** |
| 30% marketplace cap respected | Sum platform+creator+publisher shares | Creator (10-15%) + Publisher (5%) + fees ≤ 30% total |
| Rounding rule defined | Inspect rounding | Deterministic (e.g. round half-up on cents), no drift |

> `[MIGRATED-FINDING]` Calc used `(parseFloat(revenue) * parseFloat(rate)) / 100` then `.toFixed(2)` — **floating-point money**, default rate hardcoded `"10.00"`. Convert to integer cents and make rate resolution explicit.

**Runtime test:** purchases at 5% / 8% (admin override) / tier-changed rate → assert amounts to the exact cent; assert the 30% cap can't be exceeded.

**Status:** 🔍

---

## 6. ❌ Payout execution (Stripe Connect) — the core build

| Check | How to verify | Expected |
|---|---|---|
| Is a transfer **actually executed**? | grep `createTransfer` call-sites | An attributed, approved commission triggers a real `stripe.transfers.create` |
| `source_transaction` used (direct-charge model) | grep `source_transaction` | Commission pulled from the connected charge, not a bare transfer |
| **Webhook idempotency** | Look for processed-event guard | Duplicate webhook delivery does **not** double-pay |
| **Min-transfer threshold** ($0.50) | Check payout trigger | Sub-threshold balances accrue, don't fire failing transfers |
| Payout **status state machine** | Inspect `affiliate_payouts` transitions | `pending → processing → paid → failed`, driven by Connect webhooks |
| `account.updated` / onboarding gating | Check payout precondition | No payout until connected account `payouts_enabled` |
| Metadata for audit trail | Inspect transfer metadata | `affiliateId`, `commissionId`, `videoId` tagged |

> `[MIGRATED-FINDING]` `createTransfer` is **defined but never called**; `source_transaction`, idempotency, and min-threshold are **absent**. This whole block is the build, not a check.

**Runtime test (test mode):** onboard a test connected account → approve a commission → assert transfer created + status transitions; replay the same webhook → assert **no** second payout; sub-$0.50 → assert skipped.

**Status:** ❌

---

## 7. Data accuracy reconciliation (her "accurate viewing data reflecting UTM")

| Check | How to verify | Expected |
|---|---|---|
| Dashboard numbers == underlying events | Cross-sum views/clicks/conversions vs raw rows | Exact match, no double-count |
| Publisher sees **only their** reposts | Log in as publisher | Scoped to that publisher's UTMs/earnings; can't see others' |
| Admin sees all + can override commission | Log in as admin | Per-user & per-video commission edit works and flows into calc |
| Earnings == ledger == Stripe | Compare dashboard vs `commission_transactions` vs Stripe transfers | Three-way match |

**Status:** 🔍

---

## 8. Publisher-dashboard specifics (newly added on Replit — audit fresh)

- [ ] Tier → video limit enforced (Basic ≤ 5 videos) server-side, not just UI.
- [ ] Tier → commission rate actually feeds §5 (higher tier = higher commission).
- [ ] Subscription + overage billing wired to the same Stripe account.
- [ ] Publisher-as-Creator/Brand role overlap doesn't leak data or double-count earnings.
- [ ] Authorization: a publisher can't assign themselves another's UTM or claim another's conversions.

**Status:** 🔍

---

## Priority order (what to check first)
1. **§4b spoofable purchases** + **§4 round-trip** — if purchases aren't store-verified, nothing downstream is trustworthy.
2. **§6 payout execution** — the contracted core; currently unbuilt.
3. **§5 money math** — float → integer cents.
4. **§8 publisher tiers** feeding the rate.
5. Everything else (views/clicks/dashboards) is comparatively low-risk.

---

## Client report template ("what's solid / what I fixed / what's needed")

> Fill statuses after the audit. Keep it factual — it doubles as proof of value and sets honest expectations.

**Affiliate / UTM System — Verification Report**

*Your question: does the system use UTM codes to attribute each repost to the right affiliate and pay them correctly, with accurate viewing data?*

**How attribution works today**
- Each video + each publisher repost gets a unique UTM code. → `[✅/⚠️/❌]`
- Embed views & product clicks are logged and attributed to the affiliate via that code. → `[✅/⚠️/❌]`
- Viewing/UTM dashboard data reconciles to the underlying events. → `[✅/⚠️/❌]`

**What I verified is solid**
- …

**What I fixed**
- …

**What still needs building (and why it matters to your revenue)**
- **Verified purchase attribution:** purchases must be confirmed by the brand store (signed webhook), not trusted from the browser — otherwise commissions can be fabricated. → `[❌ build]`
- **60-day attribution window:** persist click→affiliate mapping so a sale within 60 days credits the right publisher. → `[status]`
- **Automated payouts:** turn an attributed, approved commission into a real Stripe Connect transfer to the affiliate, with idempotency, a $0.50 floor, and pending→paid tracking. → `[❌ build]`
- **Integer-cents money math** across commission calc. → `[status]`

**Bottom line:** attribution *logic* is [state]; the money-movement and verified-purchase pieces are the focus of this phase and are what make the numbers trustworthy for your investor/first sales.
