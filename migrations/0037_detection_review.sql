-- Placement Review, phase 1 (DETECTION_REVIEW.md).
--
-- AI detection used to go straight to the carousel: import-detections turned
-- EVERY result into a live overlay, so a wrong match (two near-identical
-- products are the easy mistake) was shoppable before anyone looked at it.
-- Each result now carries a review state, and only accepted results can be
-- imported.
--
--   pending   detected, waiting for a person
--   accepted  a person approved it; eligible for the carousel
--   rejected  a person deleted it; can never be imported unless restored
--
-- imported_at makes import one-shot per result, so pressing "Add to carousel"
-- twice (or re-running it after new approvals) never duplicates an overlay.
DO $$ BEGIN
  CREATE TYPE detection_review_status AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE video_detection_results
  ADD COLUMN IF NOT EXISTS review_status detection_review_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS reviewed_by varchar REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS imported_at timestamp;

-- Every row that exists when this runs predates review and was handled under
-- the old all-or-nothing rule, so it counts as accepted and already imported.
-- The ledger runs this file once. (Production had none on 29 Sep 2026: one
-- failed job, zero results.)
UPDATE video_detection_results
   SET review_status = 'accepted', imported_at = COALESCE(created_at, now());

CREATE INDEX IF NOT EXISTS video_detection_results_video_review_idx
  ON video_detection_results (video_id, review_status);
