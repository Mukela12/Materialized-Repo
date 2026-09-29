/**
 * The AI detection pipeline for one job: gather the tagged brands' catalogs,
 * sample frames, ask Gemini what is in them, and store the placements as
 * PENDING review (see server/placementReview.ts; nothing here reaches the
 * carousel).
 *
 * Moved out of the POST /api/videos/:id/detections handler unchanged, so the
 * route and scripts/run-detection.ts run the same code.
 */
import { storage } from "./storage";
import { ai, batchAnalyzeFrames, consolidateDetections, framesToSample, geminiConfigured, GEMINI_MODEL, type ProductInfo } from "./replit_integrations/detection/client";
import { detectAiGeneratedContent } from "./replit_integrations/detection/aiContentDetector";
import { sampleVideoFrames } from "./frameSampler";

/** Stored on the job when this server has no Gemini key; shown to the uploader. */
export const DETECTION_NOT_CONFIGURED = "AI detection is not set up on this server yet";

export interface DetectionRequest {
  brandIds?: string[];
  videoTitle?: string;
  videoDescription?: string;
}

export async function runDetectionJob(
  job: { id: string },
  videoId: string,
  { brandIds, videoTitle, videoDescription }: DetectionRequest,
  isBrandInventoryDiscoverable: (brandId: string) => Promise<boolean>,
): Promise<void> {
  try {
    await storage.updateDetectionJob(job.id, {
      status: "processing",
      startedAt: new Date(),
    });

    // Gather product catalog from selected brands. An UNSUBSCRIBED brand can
    // still be tagged — that is how it gets pulled onto the platform — but its
    // inventory is not discoverable, so detection has nothing to match against
    // and the video simply is not shoppable until the brand subscribes.
    const allProducts: ProductInfo[] = [];
    for (const brandId of (brandIds || [])) {
      const brand = await storage.getBrand(brandId);
      if (!(await isBrandInventoryDiscoverable(brandId))) {
        console.log(
          `[Detection] Skipping catalog for brand ${brandId} (${brand?.name ?? "unknown"}) — not subscribed`,
        );
        continue;
      }
      const products = await storage.getProducts(brandId);
      for (const product of products) {
        allProducts.push({
          id: product.id,
          name: product.name,
          description: product.description || null,
          category: product.category || null,
          brandId: product.brandId || brandId,
          brandName: brand?.name || "Unknown Brand",
        });
      }
    }

    // Fallback path — today's metadata-only "text guess". Behavior is
    // byte-for-byte identical to before: same prompt, same parsing, same
    // zeroed timestamps. `note` records why we ended up here for the badge.
    const runTextGuess = async (note?: string) => {
      let detectedProducts: Array<{ productId: string; confidence: number }> = [];

      if (allProducts.length > 0) {
        const catalogJson = JSON.stringify(allProducts.map(p => ({
          id: p.id, name: p.name, category: p.category, description: p.description, brand: p.brandName,
        })));
        const prompt = `You are a video product placement analyst. Given a video with the following metadata:
Title: "${videoTitle || "Untitled Video"}"
Description: "${videoDescription || "No description provided"}"

And the following product catalog:
${catalogJson}

Identify which products from the catalog are most likely to appear or be featured in this video. Return a JSON array with objects like: { "productId": "<id>", "confidence": <0.0-1.0> }. Only include products with confidence > 0.5. Return ONLY valid JSON, no explanation.`;

        const result = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          detectedProducts = JSON.parse(jsonMatch[0]);
        }
      }

      // Store detection results
      for (const det of detectedProducts) {
        const product = allProducts.find(p => p.id === det.productId);
        if (product) {
          await storage.createDetectionResult({
            jobId: job.id,
            videoId: videoId,
            productId: det.productId,
            brandId: product.brandId,
            confidence: det.confidence.toString(),
            frameTimestamp: "0",
            startTime: "0",
            endTime: "0",
            boundingBox: null,
          });
        }
      }

      await storage.updateDetectionJob(job.id, {
        status: "completed",
        completedAt: new Date(),
        totalFrames: 30,
        processedFrames: 30,
        ...(note ? { error: note } : {}),
      });
    };

    // Real path — frame-based vision. Runs only when we can actually sample
    // frames from the stored video; otherwise we degrade to the text guess.
    //
    // With no Gemini key at all there is nothing to degrade TO: the text
    // guess calls Gemini as well, and it used to die on a Google credentials
    // error with nothing saying why. Say it plainly instead.
    if (!geminiConfigured()) {
      await storage.updateDetectionJob(job.id, {
        status: "failed",
        completedAt: new Date(),
        error: DETECTION_NOT_CONFIGURED,
      } as any);
      return;
    }

    const video = await storage.getVideo(videoId);
    const frames = video?.videoUrl
      ? await sampleVideoFrames(video.videoUrl, {
          count: framesToSample(video.durationSeconds),
          durationSeconds: video.durationSeconds ?? null,
        })
      : [];

    if (frames.length === 0) {
      // Key present but no frames (unconfigured Cloudinary, non-Cloudinary
      // URL, or every frame fetch failed). Fall back — never fail the job.
      await runTextGuess("Frame sampling unavailable — used metadata heuristic");
      return;
    }

    await storage.updateDetectionJob(job.id, {
      totalFrames: frames.length,
      processedFrames: 0,
    });

    // Real per-frame product detection with true timestamps/bounding boxes.
    const frameData = frames.map((f) => ({
      base64: f.base64!,
      mimeType: f.mimeType,
      timestamp: f.timestamp,
    }));

    const frameAnalyses = await batchAnalyzeFrames(
      frameData,
      allProducts,
      (completed) => {
        storage.updateDetectionJob(job.id, { processedFrames: completed }).catch(() => {});
      }
    );
    // One frame is enough: every placement is reviewed by a person before it
    // reaches the carousel. Two frames dropped a 90% match on a handbag seen
    // in one clip (first real scan, 29 Sep 2026).
    const consolidated = consolidateDetections(frameAnalyses, 0.5, 1, 1);

    for (const result of consolidated) {
      await storage.createDetectionResult({
        jobId: job.id,
        videoId: videoId,
        productId: result.productId,
        brandId: result.brandId,
        confidence: result.avgConfidence.toString(),
        // The clearest frame and where the product sits in it: what the
        // review inspector shows. It used to store the first frame and
        // throw the model's box away.
        frameTimestamp: result.peakTimestamp.toString(),
        startTime: result.startTime.toString(),
        endTime: result.endTime.toString(),
        boundingBox: result.peakBoundingBox ? JSON.stringify(result.peakBoundingBox) : null,
      });
    }

    // Real AI-generated-content judgment across the same sampled frames.
    const aiVerdict = await detectAiGeneratedContent(frames);
    const note = aiVerdict
      ? `AI-content: ${aiVerdict.label} (score ${aiVerdict.score.toFixed(2)}, confidence ${aiVerdict.confidence.toFixed(2)}) — ${aiVerdict.reason}`
      : undefined;

    await storage.updateDetectionJob(job.id, {
      status: "completed",
      completedAt: new Date(),
      totalFrames: frames.length,
      processedFrames: frames.length,
      ...(note ? { error: note } : {}),
    });
  } catch (err) {
    console.error("Gemini detection error:", err);
    await storage.updateDetectionJob(job.id, { status: "failed" } as any).catch(() => {});
  }
}
