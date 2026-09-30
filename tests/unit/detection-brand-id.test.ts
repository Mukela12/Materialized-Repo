/**
 * A match is saved under the catalog's brand id, whatever the model says
 * (29 Sep 2026). The catalog the model sees lists brands by name, so it
 * answered "brandId": "Materialized Fashion", and saving the match failed on
 * the brand key: the first scan that found real products saved none of them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generate = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class { models = { generateContent: (...a: any[]) => generate(...a) }; },
}));

import { analyzeFrameForProducts, consolidateDetections } from "../../server/replit_integrations/detection/client";

const catalog = [
  { id: "p-bag", name: "Gold Crinkle Mini Bag", description: null, category: "Bags", brandId: "b-uuid-1", brandName: "Materialized Fashion" },
];
const reply = (products: unknown[]) => ({ text: JSON.stringify({ products }) });

beforeEach(() => generate.mockReset());

describe("detected products take their brand from the catalog", () => {
  it("ignores a brand name the model puts in brandId", async () => {
    generate.mockResolvedValue(reply([{ productId: "p-bag", productName: "gold bag", brandId: "Materialized Fashion", confidence: 0.9 }]));
    const fa = await analyzeFrameForProducts("x", "image/jpeg", catalog, 2);
    expect(fa.detectedProducts).toHaveLength(1);
    expect(fa.detectedProducts[0].brandId).toBe("b-uuid-1");
    expect(fa.detectedProducts[0].productName).toBe("Gold Crinkle Mini Bag");
    expect(consolidateDetections([fa], 0.5, 1, 1)[0].brandId).toBe("b-uuid-1");
  });

  it("still drops products that are not in the catalog", async () => {
    generate.mockResolvedValue(reply([{ productId: "made-up", brandId: "b-uuid-1", confidence: 0.9 }]));
    const fa = await analyzeFrameForProducts("x", "image/jpeg", catalog, 2);
    expect(fa.detectedProducts).toHaveLength(0);
  });

  it("the prompt no longer asks the model for a brand id it cannot see", async () => {
    generate.mockResolvedValue(reply([]));
    await analyzeFrameForProducts("x", "image/jpeg", catalog, 2);
    const prompt = generate.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(prompt).not.toMatch(/"brandId"/);
  });
});
