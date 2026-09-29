-- Voucher dates entered through the admin form were stored as midnight UTC,
-- which is 7-8pm the evening before in New York. A batch shown as expiring
-- 27 Nov stopped working at 7pm on 26 Nov (Thanksgiving); one shown as active
-- from 28 Sep opened at 8pm on the 27th.
--
-- The form now stores days the way shared/voucherDates.ts defines them (and
-- the way the invitation offer always has): an expiry day is the last day a
-- code works, stored as 05:00 UTC the next morning; a start day is 05:00 UTC
-- that morning. This moves the rows the old form wrote to the same rule.
--
-- Only rows at exactly 00:00:00 are touched. Nothing else writes midnight UTC:
-- scripts and invitations use 05:00, so the match is exactly the form's rows.
-- Codes affected on 29 Sep 2026: the Brooklyn batches (27 Nov), NYFW Runway
-- and Influencer Suite and Yuul Yie (10 Oct). Each now works through the day
-- the admin shows, instead of stopping the evening before.
UPDATE vouchers
   SET expires_at = expires_at + interval '1 day 5 hours'
 WHERE expires_at IS NOT NULL
   AND expires_at::time = '00:00:00';

UPDATE vouchers
   SET active_from = active_from + interval '5 hours'
 WHERE active_from IS NOT NULL
   AND active_from::time = '00:00:00';
