import { GoogleGenAI } from "@google/genai";
import { batchProcess } from "../batch/utils";

/**
 * Gemini client settings.
 *
 * On Replit the key AND a proxy base URL came from Replit's AI integration,
 * and that proxy wants no API-version segment (apiVersion ""). After the move
 * to Railway neither variable was set, so detection never ran in production.
 * A plain Google AI Studio key is now accepted under GEMINI_API_KEY too, and
 * the proxy settings apply only when the proxy URL is present: with Google's
 * own endpoint an empty apiVersion would send every request to the wrong path.
 */
export function geminiConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.AI_INTEGRATIONS_GEMINI_API_KEY || env.GEMINI_API_KEY || undefined;
  const baseUrl = env.AI_INTEGRATIONS_GEMINI_BASE_URL || undefined;
  return { apiKey, ...(baseUrl ? { httpOptions: { apiVersion: "", baseUrl } } : {}) };
}

/** Whether AI detection can run at all on this server. */
export function geminiConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!geminiConfig(env).apiKey;
}

export const ai = new GoogleGenAI(geminiConfig());

/**
 * The model every Gemini call uses. Pinned rather than "latest" so a scan
 * behaves the same from one week to the next, and overridable with
 * GEMINI_MODEL so the next retirement is a setting, not a code change:
 * gemini-2.5-flash, which this was hard-coded to, is "no longer available to
 * new users" (the client's key, 29 Sep 2026), so every scan would have failed.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

export interface ProductInfo {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  brandId: string;
  brandName: string;
}

export interface FrameAnalysis {
  frameTimestamp: number;
  detectedProducts: DetectedProduct[];
}

export interface DetectedProduct {
  productId: string;
  productName: string;
  brandId: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

function extractTextFromResponse(response: any): string {
  if (response.text) {
    return response.text;
  }
  
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) {
        return part.text;
      }
    }
  }
  
  return "";
}

function extractJsonFromText(text: string): any {
  if (!text || text.trim() === "") {
    return { products: [] };
  }
  
  let jsonText = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }
  
  const jsonStart = jsonText.indexOf("{");
  const jsonEnd = jsonText.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    return { products: [] };
  }
  
  jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(jsonText);
  } catch {
    return { products: [] };
  }
}

const PRODUCT_DETECTION_PROMPT = `Analyze this video frame/image and identify any products that match the following brand product catalog.

PRODUCT CATALOG:
{PRODUCTS}

For each product you identify in the image, respond with a JSON object:
{
  "products": [
    {
      "productId": "the matching product ID from the catalog",
      "productName": "the product name",
      "confidence": 0.0 to 1.0 (how confident you are this is the correct product),
      "boundingBox": { "x": 0.0-1.0, "y": 0.0-1.0, "width": 0.0-1.0, "height": 0.0-1.0 } (normalized coordinates)
    }
  ]
}

Rules:
- Only match products from the provided catalog
- Confidence should reflect visual similarity and clarity
- boundingBox uses normalized 0-1 coordinates relative to image dimensions
- Return empty products array if no matches found
- Only return the JSON, no explanations`;

export async function analyzeFrameForProducts(
  frameBase64: string,
  mimeType: string,
  products: ProductInfo[],
  frameTimestamp: number
): Promise<FrameAnalysis> {
  const productCatalog = products.map(p => 
    `- ID: ${p.id}, Name: ${p.name}, Brand: ${p.brandName}, Category: ${p.category || "N/A"}, Description: ${p.description || "N/A"}`
  ).join("\n");

  const prompt = PRODUCT_DETECTION_PROMPT.replace("{PRODUCTS}", productCatalog);

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: frameBase64,
              },
            },
          ],
        },
      ],
    });

    const responseText = extractTextFromResponse(response);
    const parsed = extractJsonFromText(responseText);

    const detectedProducts: DetectedProduct[] = [];
    if (Array.isArray(parsed.products)) {
      for (const p of parsed.products) {
        if (p.productId && typeof p.productId === "string") {
          const matchedProduct = products.find(prod => prod.id === p.productId);
          if (matchedProduct) {
            // Name and brand come from the catalog, not the model. The catalog
            // it is shown lists brands by name only, so its "brandId" was the
            // brand's name, and saving the match failed on the brand key
            // (first scan with real matches, 29 Sep 2026).
            detectedProducts.push({
              productId: p.productId,
              productName: matchedProduct.name,
              brandId: matchedProduct.brandId,
              confidence: typeof p.confidence === "number" ? p.confidence : 0.5,
              boundingBox: p.boundingBox && typeof p.boundingBox === "object" ? {
                x: Number(p.boundingBox.x) || 0,
                y: Number(p.boundingBox.y) || 0,
                width: Number(p.boundingBox.width) || 0,
                height: Number(p.boundingBox.height) || 0,
              } : undefined,
            });
          }
        }
      }
    }

    return {
      frameTimestamp,
      detectedProducts,
    };
  } catch (error) {
    console.error("Error analyzing frame:", error);
    return {
      frameTimestamp,
      detectedProducts: [],
    };
  }
}

export interface FrameData {
  base64: string;
  mimeType: string;
  timestamp: number;
}

export async function batchAnalyzeFrames(
  frames: FrameData[],
  products: ProductInfo[],
  onProgress?: (completed: number, total: number) => void
): Promise<FrameAnalysis[]> {
  return batchProcess(
    frames,
    async (frame) => {
      return analyzeFrameForProducts(
        frame.base64,
        frame.mimeType,
        products,
        frame.timestamp
      );
    },
    {
      concurrency: 2,
      retries: 5,
      onProgress: onProgress ? (completed, total) => onProgress(completed, total) : undefined,
    }
  );
}

export type BoundingBox = { x: number; y: number; width: number; height: number };

export interface ConsolidatedDetection {
  productId: string;
  brandId: string;
  startTime: number;
  endTime: number;
  avgConfidence: number;
  peakConfidence: number;
  /**
   * The frame where the product was clearest, and where it was in it. The
   * review inspector shows exactly this frame with this box, so a person
   * judges the match on the evidence the model had at its most confident.
   */
  peakTimestamp: number;
  peakBoundingBox: BoundingBox | null;
}

/**
 * How many frames to sample: about one every 4 seconds, at least 4 and at most
 * 12. A fixed 4 left a 60-second video with a frame every 15 seconds, so a
 * product on screen for a few seconds was usually never looked at.
 */
export function framesToSample(durationSeconds: number | null | undefined): number {
  const d = Number(durationSeconds);
  if (!Number.isFinite(d) || d <= 0) return 4;
  return Math.min(12, Math.max(4, Math.ceil(d / 4)));
}

/** A box is usable only if it is normalized 0-1 and has area. */
export function cleanBoundingBox(b: BoundingBox | undefined | null): BoundingBox | null {
  if (!b) return null;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const x = clamp(b.x), y = clamp(b.y);
  const width = Math.min(clamp(b.width), 1 - x), height = Math.min(clamp(b.height), 1 - y);
  return width > 0.005 && height > 0.005 ? { x, y, width, height } : null;
}

export function consolidateDetections(
  frameAnalyses: FrameAnalysis[],
  minConfidence: number = 0.6,
  minDuration: number = 2,
  /**
   * Frames a product must be seen in (unless it spans minDuration). 2 was a
   * guard for when detections went straight to the carousel; with a person
   * reviewing every placement, 1 keeps a product that is on screen once.
   */
  minFrames: number = 2,
): ConsolidatedDetection[] {
  const productTimelines = new Map<string, {
    timestamps: number[]; confidences: number[]; brandId: string;
    peak: { confidence: number; timestamp: number; box: BoundingBox | null };
  }>();

  for (const frame of frameAnalyses) {
    for (const product of frame.detectedProducts) {
      if (product.confidence >= minConfidence) {
        const key = product.productId;
        if (!productTimelines.has(key)) {
          productTimelines.set(key, {
            timestamps: [], confidences: [], brandId: product.brandId,
            peak: { confidence: -1, timestamp: frame.frameTimestamp, box: null },
          });
        }
        const timeline = productTimelines.get(key)!;
        timeline.timestamps.push(frame.frameTimestamp);
        timeline.confidences.push(product.confidence);
        // Strictly greater: on a tie the earlier frame keeps it.
        if (product.confidence > timeline.peak.confidence) {
          timeline.peak = {
            confidence: product.confidence,
            timestamp: frame.frameTimestamp,
            box: cleanBoundingBox(product.boundingBox),
          };
        }
      }
    }
  }

  const results: ConsolidatedDetection[] = [];

  const timelineEntries = Array.from(productTimelines.entries());
  for (const [productId, timeline] of timelineEntries) {
    if (timeline.timestamps.length === 0) continue;

    const sortedTimestamps = [...timeline.timestamps].sort((a: number, b: number) => a - b);
    const startTime = sortedTimestamps[0];
    const endTime = sortedTimestamps[sortedTimestamps.length - 1];
    const duration = endTime - startTime;

    if (duration >= minDuration || sortedTimestamps.length >= minFrames) {
      const avgConfidence = timeline.confidences.reduce((a, b) => a + b, 0) / timeline.confidences.length;
      const peakConfidence = Math.max(...timeline.confidences);

      results.push({
        productId,
        brandId: timeline.brandId,
        startTime,
        endTime: Math.max(endTime, startTime + 3),
        avgConfidence,
        peakConfidence,
        peakTimestamp: timeline.peak.timestamp,
        peakBoundingBox: timeline.peak.box,
      });
    }
  }

  return results.sort((a, b) => a.startTime - b.startTime);
}
