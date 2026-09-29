/**
 * Run AI product detection on one video, the same pipeline the upload flow
 * uses (server/detectionRunner.ts), and print what it found.
 *
 *   npx tsx scripts/run-detection.ts <videoId> <brandId> [<brandId> ...]
 *
 * Placements are stored PENDING review: nothing reaches the carousel until a
 * person accepts it in the review workspace. Needs DATABASE_URL and a Gemini
 * key (GEMINI_API_KEY, or Replit's AI_INTEGRATIONS_GEMINI_API_KEY); without
 * one the job fails with "AI detection is not set up".
 */
import { storage } from "../server/storage";
import { runDetectionJob } from "../server/detectionRunner";
import { isBrandInventoryDiscoverable } from "../server/inventoryAccess";
import { geminiConfigured } from "../server/replit_integrations/detection/client";

async function main() {
  const [videoId, ...brandIds] = process.argv.slice(2);
  if (!videoId || brandIds.length === 0) {
    console.error("usage: npx tsx scripts/run-detection.ts <videoId> <brandId> [<brandId> ...]");
    process.exit(2);
  }
  const video = await storage.getVideo(videoId);
  if (!video) throw new Error(`No video ${videoId}`);
  console.log(`Video: ${video.title} (${video.durationSeconds ?? "?"}s)`);
  console.log(`Gemini key present: ${geminiConfigured()}`);

  const job = await storage.createDetectionJob({
    videoId,
    selectedBrandIds: JSON.stringify(brandIds),
    frameSamplingRate: 1,
  });
  const started = Date.now();
  await runDetectionJob(job, videoId, { brandIds, videoTitle: video.title, videoDescription: video.description ?? "" }, isBrandInventoryDiscoverable);

  const done = await storage.getDetectionJobByVideoId(videoId);
  const results = await storage.getDetectionResults(job.id);
  console.log(`Job ${job.id}: ${done?.status} in ${((Date.now() - started) / 1000).toFixed(1)}s, frames ${done?.processedFrames}/${done?.totalFrames}`);
  if (done?.error) console.log(`Note: ${done.error}`);
  for (const r of results.sort((a, b) => Number(b.confidence) - Number(a.confidence))) {
    const product = await storage.getProduct(r.productId);
    console.log(
      `  ${Math.round(Number(r.confidence) * 100)}%  ${product?.name ?? r.productId}  ` +
      `frame ${r.frameTimestamp}s, shows ${r.startTime}-${r.endTime}s, box ${r.boundingBox ?? "none"}, ${r.reviewStatus}`,
    );
  }
  if (results.length === 0) console.log("  (no placements)");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
