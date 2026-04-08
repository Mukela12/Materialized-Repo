import { GoogleGenAI } from "@google/genai";
import { batchProcess } from "../batch/utils";

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

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
      "brandId": "the brand ID",
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
      model: "gemini-2.5-flash",
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
            detectedProducts.push({
              productId: p.productId,
              productName: p.productName || matchedProduct.name,
              brandId: p.brandId || matchedProduct.brandId,
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

export function consolidateDetections(
  frameAnalyses: FrameAnalysis[],
  minConfidence: number = 0.6,
  minDuration: number = 2
): Array<{
  productId: string;
  brandId: string;
  startTime: number;
  endTime: number;
  avgConfidence: number;
  peakConfidence: number;
}> {
  const productTimelines = new Map<string, { timestamps: number[]; confidences: number[]; brandId: string }>();

  for (const frame of frameAnalyses) {
    for (const product of frame.detectedProducts) {
      if (product.confidence >= minConfidence) {
        const key = product.productId;
        if (!productTimelines.has(key)) {
          productTimelines.set(key, { timestamps: [], confidences: [], brandId: product.brandId });
        }
        const timeline = productTimelines.get(key)!;
        timeline.timestamps.push(frame.frameTimestamp);
        timeline.confidences.push(product.confidence);
      }
    }
  }

  const results: Array<{
    productId: string;
    brandId: string;
    startTime: number;
    endTime: number;
    avgConfidence: number;
    peakConfidence: number;
  }> = [];

  const timelineEntries = Array.from(productTimelines.entries());
  for (const [productId, timeline] of timelineEntries) {
    if (timeline.timestamps.length === 0) continue;

    const sortedTimestamps = [...timeline.timestamps].sort((a: number, b: number) => a - b);
    const startTime = sortedTimestamps[0];
    const endTime = sortedTimestamps[sortedTimestamps.length - 1];
    const duration = endTime - startTime;

    if (duration >= minDuration || sortedTimestamps.length >= 2) {
      const avgConfidence = timeline.confidences.reduce((a, b) => a + b, 0) / timeline.confidences.length;
      const peakConfidence = Math.max(...timeline.confidences);

      results.push({
        productId,
        brandId: timeline.brandId,
        startTime,
        endTime: Math.max(endTime, startTime + 3),
        avgConfidence,
        peakConfidence,
      });
    }
  }

  return results.sort((a, b) => a.startTime - b.startTime);
}
