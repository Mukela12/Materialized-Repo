/**
 * Where the carousel sits.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 * Eight positions are offered, saved and enforced. The upload editor drew all
 * eight. The Brand Kit preview drew TWO — `items-start` for "top", `items-end`
 * for everything else — so "bottom-right", "left" and "top-left" all rendered
 * bottom-centre. The setting was stored correctly the whole time; only the
 * picture lied.
 *
 * That is worse than having no preview. The client's report was that the
 * positioning options did not exist, which is the correct conclusion to draw
 * when the only means of checking says nothing changes. One shared function
 * now answers the question, and these tests are what stop a second copy
 * drifting away from it again.
 */
import { describe, it, expect } from "vitest";
import { carouselPositionStyles, isStackedPosition } from "../../client/src/lib/carouselPosition";

const ALL = [
  "bottom", "top", "left", "right",
  "bottom-left", "bottom-right", "top-left", "top-right",
] as const;

describe("every position is distinct", () => {
  it("produces a different result for all eight — none silently aliases another", () => {
    const seen = ALL.map((p) => JSON.stringify(carouselPositionStyles(p)));
    expect(new Set(seen).size).toBe(ALL.length);
  });

  it("is always absolutely positioned above the video", () => {
    for (const p of ALL) {
      const s = carouselPositionStyles(p);
      expect(s.position).toBe("absolute");
      expect(Number(s.zIndex)).toBeGreaterThan(0);
    }
  });
});

describe("anchoring", () => {
  it("anchors the four corners to two edges each, and neither centres", () => {
    for (const p of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      const s = carouselPositionStyles(p);
      const [vertical, horizontal] = p.split("-");
      expect(s[vertical as "top" | "bottom"]).toBeDefined();
      expect(s[horizontal as "left" | "right"]).toBeDefined();
      // A corner that also centres would fight its own anchor.
      expect(s.transform).toBeUndefined();
    }
  });

  it("centres top and bottom horizontally", () => {
    for (const p of ["top", "bottom"] as const) {
      const s = carouselPositionStyles(p);
      expect(s.left).toBe("50%");
      expect(s.transform).toBe("translateX(-50%)");
    }
  });

  it("centres left and right vertically", () => {
    for (const p of ["left", "right"] as const) {
      const s = carouselPositionStyles(p);
      expect(s.top).toBe("50%");
      expect(s.transform).toBe("translateY(-50%)");
    }
  });

  it("falls back to bottom-centre for an unknown value rather than throwing", () => {
    // Stored data predates the enum; a null or a typo must still render.
    const s = carouselPositionStyles("nonsense");
    expect(s.bottom).toBeDefined();
    expect(s.left).toBe("50%");
  });
});

describe("offsets", () => {
  it("pushes away from whichever edge it is anchored to", () => {
    // The control has to feel the same on every position. If the offset were
    // simply added to both, a positive Y would move a top carousel down and a
    // bottom one further down — off the bottom of the video.
    expect(carouselPositionStyles("top", 0, 10).top).toBe("18px");
    expect(carouselPositionStyles("bottom", 0, 10).bottom).toBe("-2px");
    expect(carouselPositionStyles("left", 10, 0).left).toBe("18px");
    expect(carouselPositionStyles("right", 10, 0).right).toBe("-2px");
  });

  it("sits 8px off the edge when no offset is given", () => {
    expect(carouselPositionStyles("bottom-right").bottom).toBe("8px");
    expect(carouselPositionStyles("bottom-right").right).toBe("8px");
  });
});

describe("the stacking rule", () => {
  it("stacks on the sides, where there is no width to spare", () => {
    // The client's rule: a side-by-side row pinned to the left edge would run
    // across the whole video and cover the thing being sold.
    expect(isStackedPosition("left")).toBe(true);
    expect(isStackedPosition("right")).toBe(true);
  });

  it("runs side by side on top and bottom, including the corners", () => {
    for (const p of ["top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      expect(isStackedPosition(p)).toBe(false);
    }
  });
});
