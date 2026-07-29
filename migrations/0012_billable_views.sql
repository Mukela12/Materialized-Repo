-- ============================================================================
-- 0012 — Make a view worth counting
--
-- WHY THIS EXISTS
--   Overage is to be billed per view. Before that can be true, a "view" has to
--   be a defensible number. Today it is not: analytics_events has no index
--   beyond its primary key, no creator attribution, and no viewer identity — so
--   one page reload is one billable view, and the table cannot be aggregated by
--   creator over a date range without a sequential scan.
--
--   This migration adds only what a billable view needs. Nothing bills from it
--   yet; that is a later phase.
--
-- SCALE
--   Checked against production on 29 Jul 2026 before writing this: 9 rows,
--   32 kB, 3 videos. That is why plain CREATE INDEX is used rather than
--   CONCURRENTLY — there is nothing to lock and nothing to wait for. On a large
--   table this file would need rewriting, because server/migrate.ts wraps each
--   migration in a transaction and CONCURRENTLY cannot run inside one.
--
-- SAFETY
--   Additive only: two nullable columns, one backfill of a column that was NULL
--   a moment ago, and four indexes. No existing column is altered or dropped,
--   and no row is removed. Re-running is a no-op.
-- ============================================================================

-- ── Creator attribution, denormalized ───────────────────────────────────────
-- Billing asks "usage for THIS creator between these dates". Without this the
-- query joins through videos and inlines the creator's whole video-id list into
-- an IN (...) predicate. A video's owner never changes, so denormalizing is
-- safe — and it is the correct point-in-time record besides: usage should stay
-- attributed to whoever owned the video when it happened.
ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS creator_id varchar REFERENCES users(id);

-- ── Viewer identity, for deduplication only ─────────────────────────────────
-- A salted HMAC of IP + user-agent + UTC date (server/viewerIdentity.ts). The
-- date is inside the hash, so it rotates at midnight UTC and "one view per
-- viewer per video per day" needs no day column and no scheduled job.
-- Not reversible, and unlinkable to a person after 24 hours.
ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS viewer_hash text;

-- ── Backfill attribution for existing rows ──────────────────────────────────
-- Idempotent via the IS NULL guard. Rows whose video has since been deleted
-- keep a NULL creator_id and simply never appear in a creator's usage.
UPDATE analytics_events ae
   SET creator_id = v.creator_id
  FROM videos v
 WHERE ae.video_id = v.id
   AND ae.creator_id IS NULL;

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- The billing aggregate: one creator, one event type, a date range.
CREATE INDEX IF NOT EXISTS analytics_events_creator_period_idx
  ON analytics_events (creator_id, event_type, created_at);

-- Per-video dashboards and the video detail page.
CREATE INDEX IF NOT EXISTS analytics_events_video_created_idx
  ON analytics_events (video_id, created_at);

-- "Which videos belong to this creator" — on the path of every creator
-- dashboard, the trial gate, and the billing aggregate. Postgres does not index
-- foreign keys automatically, so this was a sequential scan.
CREATE INDEX IF NOT EXISTS videos_creator_id_idx
  ON videos (creator_id);

-- ── One billable view per viewer, per video, per day ────────────────────────
-- Enforced by the DATABASE, not by application logic, so two concurrent
-- requests cannot both pass a check-then-insert and write two rows. The ingest
-- route catches the violation and returns success — a viewer reloading a page
-- is normal behaviour, not an error.
--
-- Partial on purpose:
--   * only 'view' — a viewer may legitimately click several products, and
--     purchases must never be collapsed
--   * only non-NULL viewer_hash — historical rows and requests we cannot
--     identify still record, they simply are not deduplicated
CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_billable_view_uniq
  ON analytics_events (video_id, viewer_hash)
  WHERE event_type = 'view' AND viewer_hash IS NOT NULL;
