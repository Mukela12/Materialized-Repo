import { ai } from "./client";
import { batchProcess } from "../batch/utils";
import type { SampledFrame } from "../../frameSampler";

/**
 * Real, frame-based AI-generated-content detection.
 *
 * Given still frames sampled from a video, ask the Gemini vision model to judge —
 * per frame — whether the footage looks AI-generated, then aggregate the per-frame
 * verdicts into a single result: { score, confidence, label, reason }.
 *
 * This reuses the shared `ai` genai client and the same `inlineData` base64 vision
 * input the product detector already uses. It is env-gated by the caller: when the
 * Gemini key is unset, no frames are available, or the model errors, the caller
 * falls back to the existing metadata-only heuristic — this module never throws.
 */

export interface FrameAiVerdict {
  timestamp: number;
  /** 0.0 (clearly real) .. 1.0 (clearly AI-generated). */
  aiScore: number;
  /** How sure the model is about its own judgment, 0..1. */
  confidence: number;
  reason: string;
}

export type AiContentLabel = "ai_generated" | "likely_ai" | "uncertain" | "likely_real" | "real";

export interface AiContentVerdict {
  /** Aggregate 0..1 likelihood the footage is AI-generated. */
  score: number;
  /** Aggregate confidence 0..1. */
  confidence: number;
  label: AiContentLabel;
  reason: string;
  framesAnalyzed: number;
}

const AI_CONTENT_PROMPT = `You are a forensic media analyst. Examine this single still frame extracted from a video and judge whether the footage is AI-GENERATED (produced by a generative model such as Sora, Runway, Veo, Midjourney video, etc.) versus REAL camera-captured footage.

Look for tell-tale signs of generative video: warping or morphing edges, inconsistent lighting/shadows, malformed hands/text/faces, physically impossible motion blur, over-smooth "plastic" textures, flickering fine detail, and unnatural background coherence.

Respond with ONLY a JSON object, no explanation:
{
  "aiScore": 0.0 to 1.0,        // 0 = clearly real footage, 1 = clearly AI-generated
  "confidence": 0.0 to 1.0,     // how sure you are of this judgment
  "reason": "one short sentence citing the strongest visual evidence"
}`;

function extractTextFromResponse(response: any): string {
  if (response?.text) return response.text;
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (part?.text) return part.text;
    }
  }
  return "";
}

function extractJsonObject(text: string): any {
  if (!text || text.trim() === "") return null;
  let jsonText = text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonText = fenced[1].trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clamp01(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

/**
 * Judge a single frame. Never throws — returns a neutral verdict on failure so a
 * bad frame can't sink the whole video's analysis.
 */
export async function analyzeFrameForAiContent(
  frameBase64: string,
  mimeType: string,
  timestamp: number
): Promise<FrameAiVerdict> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: AI_CONTENT_PROMPT },
            { inlineData: { mimeType, data: frameBase64 } },
          ],
        },
      ],
    });

    const parsed = extractJsonObject(extractTextFromResponse(response));
    if (!parsed) {
      return { timestamp, aiScore: 0, confidence: 0, reason: "No parseable model response" };
    }

    return {
      timestamp,
      aiScore: clamp01(parsed.aiScore, 0),
      confidence: clamp01(parsed.confidence, 0.5),
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch (error) {
    console.error("AI-content frame analysis error:", error);
    return { timestamp, aiScore: 0, confidence: 0, reason: "Frame analysis failed" };
  }
}

/**
 * Map an aggregate 0..1 score to a human-readable label.
 */
export function scoreToLabel(score: number): AiContentLabel {
  if (score >= 0.8) return "ai_generated";
  if (score >= 0.6) return "likely_ai";
  if (score > 0.4) return "uncertain";
  if (score > 0.2) return "likely_real";
  return "real";
}

/**
 * Aggregate per-frame verdicts into one video-level verdict.
 *
 * Score is a confidence-weighted average of the per-frame AI scores (frames the
 * model is surer about count for more). The reason is taken from the single most
 * confident AI-leaning frame so the surfaced explanation cites real evidence.
 */
export function aggregateAiVerdicts(verdicts: FrameAiVerdict[]): AiContentVerdict {
  const usable = verdicts.filter((v) => v.confidence > 0);

  if (usable.length === 0) {
    return {
      score: 0,
      confidence: 0,
      label: "uncertain",
      reason: "No frames could be analyzed",
      framesAnalyzed: verdicts.length,
    };
  }

  const totalWeight = usable.reduce((sum, v) => sum + v.confidence, 0);
  const score = usable.reduce((sum, v) => sum + v.aiScore * v.confidence, 0) / totalWeight;
  const confidence = totalWeight / usable.length;

  // Pick the reason from the most AI-confident frame (highest aiScore*confidence).
  const strongest = [...usable].sort(
    (a, b) => b.aiScore * b.confidence - a.aiScore * a.confidence
  )[0];

  return {
    score,
    confidence,
    label: scoreToLabel(score),
    reason: strongest.reason || "Aggregated across sampled frames",
    framesAnalyzed: verdicts.length,
  };
}

/**
 * End-to-end: batch-analyze sampled frames for AI-generated content and aggregate.
 * Returns null when there are no frames to analyze (caller falls back).
 */
export async function detectAiGeneratedContent(
  frames: SampledFrame[],
  onProgress?: (completed: number, total: number) => void
): Promise<AiContentVerdict | null> {
  const usableFrames = frames.filter((f): f is SampledFrame & { base64: string } => !!f.base64);
  if (usableFrames.length === 0) return null;

  const verdicts = await batchProcess(
    usableFrames,
    (frame) => analyzeFrameForAiContent(frame.base64, frame.mimeType, frame.timestamp),
    {
      concurrency: 2,
      retries: 5,
      onProgress: onProgress ? (completed, total) => onProgress(completed, total) : undefined,
    }
  );

  return aggregateAiVerdicts(verdicts);
}
