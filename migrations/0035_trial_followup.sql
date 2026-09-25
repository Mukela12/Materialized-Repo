-- The day-2 nurture email, requested 25 Sep: 48 hours after a brand starts
-- their free trial, one email presents the creator-marketing opportunity —
-- integrate the existing affiliate program, invite five content creators.
-- "This should be like icing on the cake."
--
-- The stamp exists so the hourly job can promise exactly-once delivery: a
-- brand is due when the stamp is NULL and their account is 48+ hours old,
-- and the send marks it in the same pass.
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_followup_email_sent_at timestamp;
