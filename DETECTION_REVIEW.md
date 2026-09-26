# Placement Review — scope

**What.** The client's object-detection prototype (mtrlzd-object-detection
.replit.app) has one genuinely missing-from-MTRLZD idea: a REVIEW step
between AI detection and the live carousel — a confidence-ranked queue where
a person accepts, deletes, or sends back each detected placement before it
touches the video. Her words: for "the instance that the object detection
tool gets it wrong (if 2 products look almost identical, it can be an easy
mistake)."

**Why build it into MTRLZD rather than integrate the prototype.** The
standalone tool cannot see marketplace products or uploads (her own
conclusion, 26 Sep), its deployment has never completed a detection (ffmpeg
missing on Replit — every job dies at frame sampling), and MTRLZD already
owns the whole working substrate: detection jobs + results (with
confidence, frame timestamps and bounding boxes already in the table),
Gemini vision over sampled frames (Bunny-capable since Phase 3), real brand
inventory, and the overlay editor. Today the flow is detect →
import-ALL-as-overlays; the prototype's review queue is the missing middle.
Her UI is the design spec; the engine is ours.

## Phase 1 — review state on detections (~1 day)
- Migration: `video_detection_results.review_status`
  (pending | accepted | rejected), default pending; existing rows backfilled
  accepted (they were imported under the old all-or-nothing rule).
- Routes: list results with product/brand joined; accept / reject / restore
  per result; `import-detections` becomes import-ACCEPTED-only (the
  all-or-nothing import is the bug this feature exists to fix).
- Tests incl. the guard: a rejected placement can never reach the carousel.

## Phase 2 — the review workspace (~2 days)
Her design, in the editing suite, after detection completes:
- Queue ranked by confidence, per-brand filter, product card with catalog
  image and price.
- Placement inspector: the actual video frame at the detection's timestamp
  (ffmpeg extraction — already built), bounding box drawn over it, timing
  editable.
- Accept / delete / send-back-to-pending, then one "Add accepted to
  carousel" action into the existing overlay flow.
- Empty/failed states reuse the current metadata-fallback messaging.

## Phase 3 — staging test with the client (~0.5–1 day)
- Run against a real upload with a tagged real brand (Botnari inventory),
  client drives the review herself; screen recording of the pass.

**Out of scope:** replacing the detection model; the prototype's own
backend (pending repo access — reviewed for ideas, not for transplant);
auto-accept thresholds (a knob to add once she has used the queue).

**Estimate: ~4 days.** Proposed as the next milestone at normal (post-Bunny)
rates.
