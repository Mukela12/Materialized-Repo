import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the shared genai client so NO real model call is ever made. `generate`
// holds the per-test stub for ai.models.generateContent.
const generate = vi.fn();
vi.mock('../../server/replit_integrations/detection/client', () => ({
  ai: { models: { generateContent: (...args: any[]) => generate(...args) } },
}));

import {
  aggregateAiVerdicts,
  scoreToLabel,
  analyzeFrameForAiContent,
  detectAiGeneratedContent,
  type FrameAiVerdict,
} from '../../server/replit_integrations/detection/aiContentDetector';
import type { SampledFrame } from '../../server/frameSampler';

function frame(base64: string | undefined, timestamp: number): SampledFrame {
  return { url: `u${timestamp}`, base64, mimeType: 'image/jpeg', timestamp };
}

function modelJson(obj: unknown) {
  const part = { text: JSON.stringify(obj) };
  const candidate = { content: { parts: [part] } };
  return { candidates: [candidate] };
}

beforeEach(() => {
  generate.mockReset();
});

describe('scoreToLabel', () => {
  it('maps scores to the expected labels', () => {
    expect(scoreToLabel(0.9)).toBe('ai_generated');
    expect(scoreToLabel(0.7)).toBe('likely_ai');
    expect(scoreToLabel(0.5)).toBe('uncertain');
    expect(scoreToLabel(0.3)).toBe('likely_real');
    expect(scoreToLabel(0.1)).toBe('real');
  });
});

describe('aggregateAiVerdicts', () => {
  it('confidence-weights the score across frames', () => {
    const verdicts: FrameAiVerdict[] = [
      { timestamp: 1, aiScore: 1.0, confidence: 1.0, reason: 'warped hands' },
      { timestamp: 2, aiScore: 0.0, confidence: 0.5, reason: 'looks real' },
    ];
    const agg = aggregateAiVerdicts(verdicts);
    // weighted score = (1*1 + 0*0.5) / (1 + 0.5) = 0.666...
    expect(agg.score).toBeCloseTo(0.6667, 3);
    // confidence = totalWeight / usableCount = 1.5 / 2 = 0.75
    expect(agg.confidence).toBeCloseTo(0.75, 5);
    expect(agg.label).toBe('likely_ai');
    // reason comes from the strongest AI-leaning frame
    expect(agg.reason).toBe('warped hands');
    expect(agg.framesAnalyzed).toBe(2);
  });

  it('ignores zero-confidence (failed) frames when weighting', () => {
    const verdicts: FrameAiVerdict[] = [
      { timestamp: 1, aiScore: 0.8, confidence: 0.9, reason: 'flicker' },
      { timestamp: 2, aiScore: 0.0, confidence: 0.0, reason: 'Frame analysis failed' },
    ];
    const agg = aggregateAiVerdicts(verdicts);
    expect(agg.score).toBeCloseTo(0.8, 5);
    expect(agg.reason).toBe('flicker');
  });

  it('returns an uncertain verdict when no frames were analyzable', () => {
    const verdicts: FrameAiVerdict[] = [
      { timestamp: 1, aiScore: 0, confidence: 0, reason: 'Frame analysis failed' },
    ];
    const agg = aggregateAiVerdicts(verdicts);
    expect(agg.score).toBe(0);
    expect(agg.confidence).toBe(0);
    expect(agg.label).toBe('uncertain');
    expect(agg.framesAnalyzed).toBe(1);
  });
});

describe('analyzeFrameForAiContent', () => {
  it('parses a fenced JSON verdict from the model and clamps ranges', async () => {
    generate.mockResolvedValue({
      candidates: [
        { content: { parts: [{ text: '```json\n{"aiScore":1.4,"confidence":0.8,"reason":"melting text"}\n```' }] } },
      ],
    });
    const v = await analyzeFrameForAiContent('BASE64', 'image/jpeg', 3.5);
    expect(v.aiScore).toBe(1); // clamped from 1.4
    expect(v.confidence).toBe(0.8);
    expect(v.reason).toBe('melting text');
    expect(v.timestamp).toBe(3.5);
  });

  it('returns a neutral verdict (never throws) when the model errors', async () => {
    generate.mockRejectedValue(new Error('500 upstream'));
    const v = await analyzeFrameForAiContent('BASE64', 'image/jpeg', 2);
    expect(v.aiScore).toBe(0);
    expect(v.confidence).toBe(0);
    expect(v.reason).toBe('Frame analysis failed');
  });

  it('returns a neutral verdict when the response has no parseable JSON', async () => {
    generate.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'no json here' }] } }] });
    const v = await analyzeFrameForAiContent('BASE64', 'image/jpeg', 1);
    expect(v.confidence).toBe(0);
  });
});

describe('detectAiGeneratedContent', () => {
  it('returns null and makes NO model call when there are no usable frames', async () => {
    const result = await detectAiGeneratedContent([frame(undefined, 1), frame(undefined, 2)]);
    expect(result).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('analyzes usable frames and aggregates a verdict', async () => {
    generate
      .mockResolvedValueOnce(modelJson({ aiScore: 0.9, confidence: 0.9, reason: 'plastic skin' }))
      .mockResolvedValueOnce(modelJson({ aiScore: 0.7, confidence: 0.6, reason: 'warped edges' }));

    const result = await detectAiGeneratedContent([frame('AAA', 1), frame('BBB', 2)]);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result!.framesAnalyzed).toBe(2);
    expect(result!.label).toBe('ai_generated');
    expect(result!.reason).toBe('plastic skin');
  });
});
