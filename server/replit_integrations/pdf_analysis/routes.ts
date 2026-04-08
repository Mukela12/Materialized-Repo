import { Router, Request, Response } from "express";
import { analyzeBrandGuideline, analyzeImageForColors } from "./client";

const router = Router();

router.post("/api/analyze-brand-guidelines", async (req: Request, res: Response) => {
  try {
    const { fileData, mimeType } = req.body;

    if (!fileData) {
      return res.status(400).json({ error: "File data is required" });
    }

    let base64Data = fileData;
    if (fileData.includes(",")) {
      base64Data = fileData.split(",")[1];
    }

    const supportedTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ];

    const finalMimeType = mimeType || "application/pdf";
    if (!supportedTypes.includes(finalMimeType)) {
      return res.status(400).json({
        error: `Unsupported file type: ${finalMimeType}. Supported types: ${supportedTypes.join(", ")}`,
      });
    }

    const analysis = await analyzeBrandGuideline(base64Data, finalMimeType);

    res.json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error("Error analyzing brand guidelines:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to analyze brand guidelines",
    });
  }
});

router.post("/api/extract-colors-from-image", async (req: Request, res: Response) => {
  try {
    const { imageData, mimeType } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: "Image data is required" });
    }

    let base64Data = imageData;
    if (imageData.includes(",")) {
      base64Data = imageData.split(",")[1];
    }

    const supportedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const finalMimeType = mimeType || "image/png";

    if (!supportedTypes.includes(finalMimeType)) {
      return res.status(400).json({
        error: `Unsupported image type: ${finalMimeType}. Supported types: ${supportedTypes.join(", ")}`,
      });
    }

    const colors = await analyzeImageForColors(base64Data, finalMimeType);

    res.json({
      success: true,
      colors,
    });
  } catch (error) {
    console.error("Error extracting colors from image:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to extract colors from image",
    });
  }
});

export function setupPdfAnalysisRoutes(app: Router) {
  app.use(router);
}
