# Bunny Stream migration — scope

**Why.** Cloudinary Free caps video at 100 MiB (a 469MB editorial cannot be
uploaded) and paid Cloudinary is priced for images, not video volume. Bunny
Stream prices storage ~$0.01/GB/mo and delivery from ~$0.01/GB (volume tier
$0.005), transcodes automatically, and lifts the size cap to multi-GB. At the
client's own scenarios this is tens of dollars a month until traffic is large.

**Corrections to the estimate the client received** (it was an AI chat's
analysis, not Bunny's quote):
- Its $0.29/1k views prices every view as a full 60MB download. Adaptive
  streaming sends only watched seconds, so real delivery cost per 1k views is
  likely several times lower. Treat $0.29 as a ceiling.
- $0.005/GB is the volume tier; starting tier is ~$0.01/GB by region.
- No extra $40 VPS is needed — the app already runs on Railway. Bunny replaces
  the video layer only. Cloudinary stays (free tier) for images and fonts.

## Phase 1 — new uploads land on Bunny (~2–3 days)
- Bunny video library + pull zone; keys in Railway env.
- Server endpoint: create video object, return TUS auth signature.
- `use-upload.tsx`: browser → Bunny via TUS (resumable — a 1GB editorial on
  hotel wifi survives a dropped connection; real progress events preserved).
- Playback: enable MP4 fallback renditions so the existing custom `<video>`
  player and carousel work unchanged; `videoDelivery.ts` becomes host-aware
  (`vz-*.b-cdn.net` URLs pass through with rendition choice; Cloudinary logic
  kept for legacy URLs). Poster from Bunny's generated thumbnail.
- Raise `MAX_VIDEO_UPLOAD_BYTES` (shared/uploadLimits.ts) to the new ceiling —
  the one-line change it was built for.
- Encode-finished webhook → mark video playable (upload ≠ transcoded).

## Phase 2 — existing videos + deletion job (~1 day)
- Migrate the ~6 production videos via Bunny's fetch-from-URL API; rewrite
  stored videoUrl/thumbnail; keep Cloudinary originals until verified.
- Retention job on the existing scheduler (daily):
  - paying subscribers: videos never expire;
  - accounts whose free period lapsed AND unpaid ≥60 further days: delete
    from Bunny + mark record (metadata kept so reactivation shows what was lost);
  - NEVER delete a video with a live embed/campaign attached — check first.
  - dry-run mode first, same pattern as overage billing.

## Phase 3 — detection frame sampling (SPIKED 2026-09-06: viable)
`server/frameSampler.ts` extracts arbitrary-timestamp JPEGs via Cloudinary URL
transforms; AI detection depends on it. Bunny has no arbitrary-frame URL API.

**Spike result** — `ffmpeg -ss T -i <https url> -frames:v 1` against a real
104MB production original served with `Accept-Ranges: bytes`:
- one frame: **~3.9s**, valid JPEG; three frames (the frameSampler pattern):
  ~11s total, one short-lived process each.
- trace confirms genuine range seeking: ffmpeg jumped straight to
  `Range: bytes=103651647-` (the tail index) rather than streaming the file.
- control with ranges forbidden (`-seekable 0`): **50.6s and "partial file"** —
  so range support on the source is the load-bearing requirement.

Implementation notes:
- Enable **MP4 Fallback** on the Bunny library — the renditions are the static,
  range-served, faststart files this depends on (moov up front, so seeks will
  beat the .mov test case, which had its index at the tail).
- ffmpeg on Railway: prefer the nixpacks package over the ~75MB `ffmpeg-static`
  npm binary. Verify presence at boot and fail loud, not at first detection.
- Frame extraction becomes host-aware in frameSampler: Cloudinary URLs keep the
  URL-transform path; Bunny URLs go through the ffmpeg extractor.

## Explicitly out of scope
Profile/product images, brand fonts (stay on Cloudinary free tier); the app
server (stays on Railway); analytics (our own view tracking is host-agnostic).

**Estimate: 4–5 days.** Proposed as the first milestone of the next contract.
