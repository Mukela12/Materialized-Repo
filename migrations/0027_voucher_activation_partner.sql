-- ============================================================================
-- 0027 — Voucher activation window, and the partner behind a code
--
-- THE CLIENT: 'the CSV export does not show an Activation / Expiry Date
-- sequence. Can we include that detail in the CSV, along with a Column (blank)
-- for the Festival Organizer to add "PARTNER" to determine who belongs to which
-- code. I suppose that also needs to be entered in the backend, to determine
-- Affiliate referrals/activity.'
--
-- Two separate gaps behind one request.
--
-- ACTIVATION did not exist. A voucher worked from the instant it was minted;
-- the only date on the row was created_at. Festival codes are cut weeks before
-- the doors open, so "valid from" is a real property of the code and not a
-- reporting detail. Expiry did already exist — of 216 live vouchers exactly one
-- had it set, so the CSV column was there and empty, which reads identically to
-- missing.
--
-- PARTNER is not assigned_to. Brooklyn's 81 codes all carry assigned_to
-- 'Brooklyn' — the festival that received the batch. Which brand got any
-- individual code is known only to the organiser, who fills it in on the
-- exported spreadsheet. Without somewhere to put that answer, affiliate
-- activity can only ever be attributed to a city.
--
-- Both nullable, so all 216 existing codes keep working exactly as they do
-- today: null active_from means usable immediately, which is the behaviour
-- every one of them has now.
-- ============================================================================

ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS partner text;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS active_from timestamp;

-- Partner attribution is a reporting lookup ("everything Brooklyn's partner X
-- brought in"), so it is queried by value rather than by id.
CREATE INDEX IF NOT EXISTS vouchers_partner_idx ON vouchers (partner);
