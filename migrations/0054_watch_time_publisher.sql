-- Watch time by Publisher (client, 18 Nov 2026: Publisher analytics show only
-- their own results). A viewing that played through a Publisher's repost
-- carries that Publisher, resolved on the server from the repost's utm code
-- exactly as analytics_events.affiliate_id is, so a Publisher's average view
-- time counts only viewings on their own pages. Older rows stay null.
ALTER TABLE video_watch_time ADD COLUMN IF NOT EXISTS affiliate_id varchar REFERENCES users(id);
CREATE INDEX IF NOT EXISTS video_watch_time_affiliate_period_idx ON video_watch_time (affiliate_id, created_at) WHERE affiliate_id IS NOT NULL;
