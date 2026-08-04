-- ============================================================================
-- 0015 — A ledger of scheduled job runs
--
-- WHY THIS EXISTS
--   There was no scheduler at all. Publisher payouts and marketplace-fee
--   invoices both required an admin to log in and press a button, which meant
--   "weekly automated payouts" was not true, and the admin endpoint is
--   session-cookie gated so no external cron could reach it either.
--
--   A scheduler that lives only in process memory is not enough for money. It
--   fires only while the process happens to be alive, so a restart or a redeploy
--   at the scheduled minute skips the run silently until next week. And with
--   more than one instance running, every instance fires — paying everyone
--   twice.
--
--   This table fixes both. It records what ran and when, so:
--     - a MISSED window is detectable (compare the last completed run against
--       the schedule's previous occurrence) and caught up rather than lost;
--     - a DOUBLE run is impossible, because a run is only started if no run
--       already covers that occurrence, checked under an advisory lock.
--
-- THE UNIQUE INDEX IS THE REAL GUARD
--   (job_name, scheduled_for) is unique. Two instances racing the same window
--   both try to insert; exactly one wins and the loser gets 23505 and stands
--   down. That is a database guarantee, not a timing assumption.
--
-- STATUS
--   running   — claimed, in flight. A row stuck here means the process died
--               mid-run; it is visible rather than silently retried, because
--               re-running a half-finished payout is exactly what must not
--               happen automatically.
--   success   — completed. `detail` holds the run summary.
--   failed    — completed with an error. `detail` holds it.
--   skipped   — nothing to do (no payable commissions, no billable accruals).
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE scheduled_run_status AS ENUM ('running', 'success', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      TEXT NOT NULL,

  -- The schedule occurrence this run is for, NOT the wall-clock start. A run
  -- catching up a missed Monday is stamped with that Monday, so it cannot be
  -- confused with the following week's run.
  scheduled_for TIMESTAMP NOT NULL,

  status        scheduled_run_status NOT NULL DEFAULT 'running',
  started_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   TIMESTAMP,
  items         INTEGER NOT NULL DEFAULT 0,
  detail        TEXT
);

-- One run per job per occurrence. This is what stops two instances, or a
-- catch-up racing a live tick, from both executing the same window.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_job_run_occurrence_uniq
  ON scheduled_job_runs (job_name, scheduled_for);

CREATE INDEX IF NOT EXISTS scheduled_job_run_recent_idx
  ON scheduled_job_runs (job_name, scheduled_for DESC);
