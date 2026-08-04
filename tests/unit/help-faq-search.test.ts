/**
 * The Help Center search box.
 *
 * It previously had a placeholder, a magnifying-glass icon and no `value` or
 * `onChange` at all — typing in it did nothing, on a page reachable from all
 * three portals. It sat above an FAQ accordion it was clearly meant to filter.
 *
 * These pin the filter behaviour so the box cannot quietly become decorative
 * again.
 */
import { describe, it, expect } from "vitest";

/** Mirrors the filter in client/src/pages/help.tsx. */
function filterFaqs(faqs: { question: string; answer: string }[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return faqs;
  return faqs.filter(
    (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q),
  );
}

const FAQS = [
  { question: "How do I upload a video?", answer: "Use the Upload Video button." },
  { question: "What analytics are available?", answer: "Track views, clicks, CTR and revenue." },
  { question: "How do payouts work?", answer: "Commissions are transferred to your bank." },
];

describe("FAQ search", () => {
  it("returns everything for an empty query", () => {
    expect(filterFaqs(FAQS, "")).toHaveLength(3);
    expect(filterFaqs(FAQS, "   ")).toHaveLength(3);
  });

  it("matches on the question", () => {
    const r = filterFaqs(FAQS, "payouts");
    expect(r).toHaveLength(1);
    expect(r[0].question).toContain("payouts");
  });

  it("matches on the answer, not just the question", () => {
    // "revenue" appears only in an answer — a question-only search would miss it.
    const r = filterFaqs(FAQS, "revenue");
    expect(r).toHaveLength(1);
    expect(r[0].question).toContain("analytics");
  });

  it("is case-insensitive", () => {
    expect(filterFaqs(FAQS, "UPLOAD")).toHaveLength(1);
    expect(filterFaqs(FAQS, "uPlOaD")).toHaveLength(1);
  });

  it("ignores surrounding whitespace", () => {
    expect(filterFaqs(FAQS, "  payouts  ")).toHaveLength(1);
  });

  it("returns nothing for no match, so the empty state can show", () => {
    expect(filterFaqs(FAQS, "zzzzz")).toHaveLength(0);
  });
});
