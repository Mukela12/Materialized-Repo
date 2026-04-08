import type { Express } from "express";
import { batchAnalyzeFrames, consolidateDetections, type ProductInfo, type FrameData } from "./client";

export function registerDetectionRoutes(app: Express, storage: any) {
  app.post("/api/detection/analyze-frames", async (req, res) => {
    try {
      const { frames, brandIds, jobId, videoId } = req.body;

      if (!frames || !Array.isArray(frames) || frames.length === 0) {
        return res.status(400).json({ success: false, error: "No frames provided" });
      }

      if (!brandIds || !Array.isArray(brandIds) || brandIds.length === 0) {
        return res.status(400).json({ success: false, error: "No brand IDs provided" });
      }

      const allProducts: ProductInfo[] = [];
      for (const brandId of brandIds) {
        const brand = await storage.getBrand(brandId);
        const products = await storage.getProducts(brandId);
        for (const product of products) {
          allProducts.push({
            id: product.id,
            name: product.name,
            description: product.description,
            category: product.category,
            brandId: product.brandId,
            brandName: brand?.name || "Unknown",
          });
        }
      }

      if (allProducts.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: "No products found for the selected brands" 
        });
      }

      if (jobId) {
        await storage.updateDetectionJob(jobId, { 
          status: "processing",
          startedAt: new Date(),
          totalFrames: frames.length,
          processedFrames: 0,
        });
      }

      const frameData: FrameData[] = frames.map((f: { base64: string; mimeType?: string; timestamp: number }) => ({
        base64: f.base64,
        mimeType: f.mimeType || "image/jpeg",
        timestamp: f.timestamp, // Expected in seconds
      }));

      let processedCount = 0;
      const progressUpdates: number[] = [];
      const frameAnalyses = await batchAnalyzeFrames(
        frameData,
        allProducts,
        (completed, total) => {
          processedCount = completed;
          progressUpdates.push(completed);
        }
      );

      if (jobId && progressUpdates.length > 0) {
        await storage.updateDetectionJob(jobId, { processedFrames: processedCount });
      }

      const consolidatedResults = consolidateDetections(frameAnalyses, 0.5, 1);

      if (jobId && videoId) {
        for (const result of consolidatedResults) {
          await storage.createDetectionResult({
            jobId,
            videoId,
            productId: result.productId,
            brandId: result.brandId,
            confidence: result.avgConfidence.toString(),
            frameTimestamp: result.startTime.toString(),
            startTime: result.startTime.toString(),
            endTime: result.endTime.toString(),
            boundingBox: null,
          });
        }

        await storage.updateDetectionJob(jobId, { 
          status: "completed",
          completedAt: new Date(),
          processedFrames: frames.length,
        });
      }

      return res.json({
        success: true,
        framesAnalyzed: frameData.length,
        detectionsFound: consolidatedResults.length,
        results: consolidatedResults,
      });

    } catch (error) {
      console.error("Detection analysis error:", error);
      return res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Analysis failed" 
      });
    }
  });

  app.post("/api/detection/analyze-image", async (req, res) => {
    try {
      const { imageBase64, mimeType, brandIds } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ success: false, error: "No image provided" });
      }

      if (!brandIds || !Array.isArray(brandIds) || brandIds.length === 0) {
        return res.status(400).json({ success: false, error: "No brand IDs provided" });
      }

      const allProducts: ProductInfo[] = [];
      for (const brandId of brandIds) {
        const brand = await storage.getBrand(brandId);
        const products = await storage.getProducts(brandId);
        for (const product of products) {
          allProducts.push({
            id: product.id,
            name: product.name,
            description: product.description,
            category: product.category,
            brandId: product.brandId,
            brandName: brand?.name || "Unknown",
          });
        }
      }

      const frameData: FrameData[] = [{
        base64: imageBase64,
        mimeType: mimeType || "image/jpeg",
        timestamp: 0,
      }];

      const [frameAnalysis] = await batchAnalyzeFrames(frameData, allProducts);

      return res.json({
        success: true,
        detections: frameAnalysis?.detectedProducts || [],
      });

    } catch (error) {
      console.error("Image detection error:", error);
      return res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Analysis failed" 
      });
    }
  });
}
