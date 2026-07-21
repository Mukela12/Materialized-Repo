# Materialized — Event Launch Build Plan

**Target:** first-brand event / content session — **next Saturday (~25 July 2026), ~8 days out**
**Contract:** hourly (Upwork, funded milestone)

> **Two open questions this plan assumes** (confirm to finalise):
> 1. ✅ **Fee model (CONFIRMED 18 Jul):** gross sale → **Brand 85%** + **Marketplace fee 15%**. The 15% covers **Creator 8% + Publisher 2% + platform/Stripe ~5%**. All defaults **admin-adjustable**, and **per-user** for creator/publisher commissions.
> 2. **Sales data at the event** — assumes **live UTM/click tracking + post-event sales reconciliation** from the brand's Shopify export; the automated store order-webhook is **fast-follow**. *If live sales figures must tick during the event, the store webhook moves into launch scope (+~1–2 days).*
>
> **Hours are preliminary** until the Replit version (current source of truth) is pulled and audited. They firm up after that.

---

## ✅ Must be live for the event

| # | Item | Current state | Work | Est. hrs |
|---|---|---|---|---|
| 1 | Pull Replit repo → reconcile as single source of truth → redeploy to production domain | — | Export, review Publisher build, deploy, wire env (Stripe **test**, Cloudinary, Resend) | 6–10 |
| 2 | Brand inventory API sync (Shopify/Woo) | Exists | Verify end-to-end with the real brand's store | 2–4 |
| 3 | Product discovery in video editor | Exists | Verify against synced inventory | 2–3 |
| 4 | Product carousel on embed + UTM tracking | Exists | Verify + fix responsive / UTM capture | 3–5 |
| 5 | Fee split calc — Brand 85% / fee 15% (Creator 8% + Publisher 2% + platform ~5%), all admin-adjustable per user | Partial | Build configurable fee/commission calc in integer cents, surface in dashboard | 4–6 |
| 6 | Close spoofable-purchase hole (checklist §4b) | Not built | Authenticate/verify purchase events so sales & commission totals are trustworthy | 3–6 |
| 7 | Dashboard analytics (views, clicks, sales, commission totals) | Mostly exists | Verify totals reconcile to raw events; wire fee into totals | 4–7 |

**Launch subtotal: ~23–40 hrs**

---

## ⏭ Fast-follow (after the event)

| Item | Why it can wait | Est. hrs |
|---|---|---|
| Automated affiliate/publisher payouts — Stripe Connect transfers, `source_transaction`, webhook idempotency, $0.50 floor, pending→processing→paid→failed | Influencer payouts are a 30-day norm; needs careful test-mode verification | 15–25 |
| Verified brand-store order webhook + 60-day attribution window | Replaces post-event manual reconciliation with automation | 8–15 |
| Integer-cents money refactor across commission calc | Correctness hardening | 2–4 |

---

## Dependencies & risks
- **Stripe account review (2–3 days):** live payments won't switch on until it clears. Doesn't block the event (payouts are fast-follow) but does block any real money movement.
- **Replit repo pull:** nothing can be finalised or built until the actual codebase is in hand. **Current blocker.**
- **§4b (spoofable sales):** must land if *any* sales/commission figures are shown at the event with a real brand watching.
- **Email/DNS deliverability:** separate track (assistant + GoDaddy); `mail-tester.com` confirms.

---

## Indicative sequence
- **Days 1–2:** pull Replit repo, reconcile source of truth, deploy to production domain + env; run the affiliate audit checklist §0–§4b.
- **Days 3–5:** verify launch features (inventory sync, product discovery, carousel/UTM); build the 15% fee calc; close the spoof hole.
- **Days 6–7:** dashboard totals reconcile + fee wired in; full end-to-end test against the brand's real store in **test mode**.
- **Day 8 (buffer):** polish, dry-run the event flow, hand over.

---

*Companion doc: `AFFILIATE_AUDIT_CHECKLIST.md` (the verification method behind items 4–7).*
