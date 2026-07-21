import { Router, Request, Response } from "express";
import { analyzeBrandGuideline, analyzeImageForColors } from "./client";

const router = Router();

// Reject decoded payloads larger than this to fail fast with a clear message
// (the global JSON body limit is the hard ceiling; this keeps the AI call bounded).
const MAX_DECODED_BYTES = 20 * 1024 * 1024; // ~20 MB decoded

// Approximate the decoded byte length of a base64 string without allocating a Buffer.
function decodedByteLength(base64: string): number {
  const len = base64.length;
  let padding = 0;
  if (len >= 1 && base64[len - 1] === "=") padding++;
  if (len >= 2 && base64[len - 2] === "=") padding++;
  return Math.floor((len * 3) / 4) - padding;
}

router.post("/api/analyze-brand-guidelines", async (req: Request, res: Response) => {
  try {
    const sessionUserId = (req.session as any)?.userId;
    if (!sessionUserId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
      return res.status(503).json({ error: "AI analysis is not configured" });
    }

    const { fileData, mimeType } = req.body;

    if (!fileData || typeof fileData !== "string") {
      return res.status(400).json({ error: "File data is required" });
    }

    let base64Data = fileData;
    if (fileData.includes(",")) {
      base64Data = fileData.split(",")[1];
    }

    if (!base64Data) {
      return res.status(400).json({ error: "File data is empty or malformed" });
    }

    if (decodedByteLength(base64Data) > MAX_DECODED_BYTES) {
      return res.status(413).json({
        error: "File is too large. Maximum supported size is 20MB.",
      });
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
    const sessionUserId = (req.session as any)?.userId;
    if (!sessionUserId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
      return res.status(503).json({ error: "AI analysis is not configured" });
    }

    const { imageData, mimeType } = req.body;

    if (!imageData || typeof imageData !== "string") {
      return res.status(400).json({ error: "Image data is required" });
    }

    let base64Data = imageData;
    if (imageData.includes(",")) {
      base64Data = imageData.split(",")[1];
    }

    if (!base64Data) {
      return res.status(400).json({ error: "Image data is empty or malformed" });
    }

    if (decodedByteLength(base64Data) > MAX_DECODED_BYTES) {
      return res.status(413).json({
        error: "Image is too large. Maximum supported size is 20MB.",
      });
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
