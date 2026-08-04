/**
 * Turning a saved brand kit into carousel settings for a new video.
 *
 * The upload modal ignored the brand kit entirely — every video started from the
 * generic defaults, so a brand that had set its colours, font and button label
 * had to redo that work on every upload. The Brand Kit page meanwhile told them
 * "These settings will be applied to all new video uploads".
 *
 * The mapping is where that promise is kept, and it has two ways to go wrong
 * quietly: treating an unset column as a real value (blanking a good default to
 * null or ""), and dropping a field when CarouselSettings grows. Both are pinned
 * below. `default_button_color` is nullable, and an empty string rather than
 * NULL has already been observed in this database in the equivalent video
 * thumbnail column — so "" must be treated as unset, not as a colour.
 */
import { describe, it, expect } from "vitest";
import {
  carouselSettingsFromBrandKit,
  defaultCarouselSettings,
} from "../../client/src/components/ProductCarouselEditor";

describe("carouselSettingsFromBrandKit", () => {
  it("falls back to defaults when there is no brand kit", () => {
    expect(carouselSettingsFromBrandKit(null)).toEqual(defaultCarouselSettings);
    expect(carouselSettingsFromBrandKit(undefined)).toEqual(defaultCarouselSettings);
  });

  it("applies every field a brand kit can specify", () => {
    const result = carouselSettingsFromBrandKit({
      defaultButtonFont: "Playfair Display",
      defaultButtonColor: "#ff0000",
      defaultButtonTextColor: "#000000",
      defaultCornerRadius: 4,
      defaultBackgroundOpacity: 90,
      defaultShowThumbnail: false,
      defaultShowButton: false,
      defaultShowPrice: false,
      defaultShowTitle: false,
      defaultButtonLabel: "SHOP NOW",
      defaultPosition: "top",
    });

    expect(result).toMatchObject({
      buttonFont: "Playfair Display",
      buttonColor: "#ff0000",
      buttonTextColor: "#000000",
      cornerRadius: 4,
      backgroundOpacity: 90,
      showThumbnail: false,
      showButton: false,
      showPrice: false,
      showTitle: false,
      buttonLabel: "SHOP NOW",
      position: "top",
    });
  });

  it("keeps false — a brand that turned the price off means it", () => {
    // The bug this guards: `k.defaultShowPrice || fallback` would silently turn
    // the price back on, because false is falsy.
    const result = carouselSettingsFromBrandKit({ defaultShowPrice: false });
    expect(result.showPrice).toBe(false);
  });

  it("keeps 0 — an opacity or radius of zero is a real choice", () => {
    const result = carouselSettingsFromBrandKit({
      defaultCornerRadius: 0,
      defaultBackgroundOpacity: 0,
    });
    expect(result.cornerRadius).toBe(0);
    expect(result.backgroundOpacity).toBe(0);
  });

  it("treats null and empty string as unset, not as a value", () => {
    const result = carouselSettingsFromBrandKit({
      defaultButtonColor: null,
      defaultButtonTextColor: "",
      defaultButtonFont: "   ",
      defaultCornerRadius: null,
      defaultShowTitle: null,
    });

    expect(result.buttonColor).toBe(defaultCarouselSettings.buttonColor);
    expect(result.buttonTextColor).toBe(defaultCarouselSettings.buttonTextColor);
    expect(result.buttonFont).toBe(defaultCarouselSettings.buttonFont);
    expect(result.cornerRadius).toBe(defaultCarouselSettings.cornerRadius);
    expect(result.showTitle).toBe(defaultCarouselSettings.showTitle);
  });

  it("leaves the settings a brand kit has no column for alone", () => {
    // Offsets, delay and the three font sizes exist on CarouselSettings but not
    // on brand_kits. A partial kit must not blank them.
    const result = carouselSettingsFromBrandKit({ defaultButtonColor: "#123456" });

    expect(result.positionOffsetX).toBe(defaultCarouselSettings.positionOffsetX);
    expect(result.positionOffsetY).toBe(defaultCarouselSettings.positionOffsetY);
    expect(result.delayUntilEnd).toBe(defaultCarouselSettings.delayUntilEnd);
    expect(result.titleFont).toBe(defaultCarouselSettings.titleFont);
    expect(result.titleFontSize).toBe(defaultCarouselSettings.titleFontSize);
    expect(result.priceFontSize).toBe(defaultCarouselSettings.priceFontSize);
    expect(result.buttonFontSize).toBe(defaultCarouselSettings.buttonFontSize);
  });

  it("returns a complete settings object, never a partial one", () => {
    // The editor reads every key; a missing one renders as undefined.
    const result = carouselSettingsFromBrandKit({ defaultButtonColor: "#123456" });
    expect(Object.keys(result).sort()).toEqual(Object.keys(defaultCarouselSettings).sort());
  });

  it("ignores junk instead of throwing", () => {
    expect(carouselSettingsFromBrandKit("nonsense")).toEqual(defaultCarouselSettings);
    expect(carouselSettingsFromBrandKit(42)).toEqual(defaultCarouselSettings);
    expect(carouselSettingsFromBrandKit({ defaultCornerRadius: "16" }).cornerRadius)
      .toBe(defaultCarouselSettings.cornerRadius);
    expect(carouselSettingsFromBrandKit({ defaultCornerRadius: NaN }).cornerRadius)
      .toBe(defaultCarouselSettings.cornerRadius);
  });
});
