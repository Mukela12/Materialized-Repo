-- Card on file as the price of free access.
--
-- The client's rule, verbatim: "When the user enters a voucher for a
-- subscription free period ... they must still agree to be accountable for
-- overage charges, and enter their card information. That is the single
-- requirement of having free access to our software."
--
-- card_required is stamped at voucher redemption, so the rule applies to
-- voucher signups from now on and to NOBODY retroactively: existing accounts
-- (the client's own, manual comps, test accounts) have it false and are
-- untouched. card_on_file is set by the Stripe webhook when a setup-mode
-- checkout vaults a card, and also by any completed paid checkout — a card
-- captured for a subscription is a card on file.
ALTER TABLE users ADD COLUMN IF NOT EXISTS overage_card_required boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_on_file boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_on_file_at timestamp;
