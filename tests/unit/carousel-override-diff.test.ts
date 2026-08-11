/**
 * A per-video override stores only what differs from the creator's defaults.
 *
 * ── The behaviour this protects ──────────────────────────────────────────────
 * The client asked for both halves of this: the Brand Kit is "Default settings
 * for this user and all of their videos", AND "the user should have
 * capabilities to edit each unique video setting".
 *
 * The obvious implementation — save the settings object the editor is holding —
 * satisfies the second half and quietly destroys the first. Every one of the
 * eighteen fields becomes an override, so that video is detached from the brand
 * kit forever. She changes her palette for a season, every video follows except
 * the handful she once tweaked, and nothing on screen says why.
 *
 * The override table's columns are nullable precisely so NULL can mean inherit.
 * These tests are what stop a future "just save the whole thing" from throwing
 * that away.
 */
import { describe, it, expect } from "vitest";
import {
  CAROUSEL_DEFAULTS, overrideFromSettings, overriddenKeys, emptyOverride,
  applyOverride, settingsFromBrandKit, type CarouselSettings,
} from "../../shared/carousel";

const base: CarouselSettings = {
  ...CAROUSEL_DEFAULTS,
  buttonColor: "#1650a8",
  carouselBackgroundColor: "#1f1b6d",
  cornerRadius: 30,
};

describe("storing an override", () => {
  it("stores nothing when nothing was changed", () => {
    const out = overrideFromSettings(base, { ...base });
    expect(Object.values(out).every((v) => v === null)).toBe(true);
    expect(overriddenKeys(out)).toEqual([]);
  });

  it("stores only the field that changed", () => {
    const edited = { ...base, buttonColor: "#ff0000" };
    const out = overrideFromSettings(base, edited);
    expect(out.buttonColor).toBe("#ff0000");
    expect(out.carouselBackgroundColor).toBeNull();
    expect(out.cornerRadius).toBeNull();
    expect(overriddenKeys(out)).toEqual(["buttonColor"]);
  });

  it("NULLs a field that was changed back, restoring inheritance", () => {
    // Unticking a change must return the field to the brand kit, not freeze
    // the value it happens to have right now.
    const wasOverridden = { buttonColor: "#ff0000", cornerRadius: 8 };
    const restored = overrideFromSettings(base, { ...base });
    expect(restored.buttonColor).toBeNull();
    expect(restored.cornerRadius).toBeNull();
    expect(applyOverride(base, restored).buttonColor).toBe(wasOverridden.buttonColor === "#ff0000" ? base.buttonColor : base.buttonColor);
  });

  it("ignores a colour that differs only in case", () => {
    // A colour input hands back "#1F1B6D" for a stored "#1f1b6d". Treating that
    // as a change would detach the field over a difference nobody can see.
    const edited = { ...base, carouselBackgroundColor: "#1F1B6D" };
    expect(overrideFromSettings(base, edited).carouselBackgroundColor).toBeNull();
  });

  it("stores `false`, which is a real value and not an absence", () => {
    // A truthiness check here would make every "off" toggle impossible to
    // override — the video could never turn commerce off if the kit had it on.
    const edited = { ...base, commerceEnabled: false, showPrice: false };
    const out = overrideFromSettings(base, edited);
    expect(out.commerceEnabled).toBe(false);
    expect(out.showPrice).toBe(false);
    expect(overriddenKeys(out).sort()).toEqual(["commerceEnabled", "showPrice"]);
  });

  it("stores 0, likewise", () => {
    const edited = { ...base, cornerRadius: 0, backgroundOpacity: 0 };
    const out = overrideFromSettings(base, edited);
    expect(out.cornerRadius).toBe(0);
    expect(out.backgroundOpacity).toBe(0);
  });

  it("covers the offsets that only a video has", () => {
    const edited = { ...base, positionOffsetX: 12, delayUntilEnd: true };
    const out = overrideFromSettings(base, edited);
    expect(out.positionOffsetX).toBe(12);
    expect(out.delayUntilEnd).toBe(true);
  });
});

describe("the whole point: the brand kit still reaches the video", () => {
  it("a later change to the defaults moves an un-overridden field", () => {
    const kit = { defaultButtonColor: "#1650a8", defaultCornerRadius: 30 };
    const before = settingsFromBrandKit(kit);

    // She overrides ONLY the button colour on this video.
    const override = overrideFromSettings(before, { ...before, buttonColor: "#ff0000" });

    // Later she changes her default corner radius for the season.
    const after = settingsFromBrandKit({ ...kit, defaultCornerRadius: 4 });
    const rendered = applyOverride(after, override);

    expect(rendered.cornerRadius).toBe(4);        // followed the new default
    expect(rendered.buttonColor).toBe("#ff0000"); // kept its own choice
  });

  it("saving the whole settings object instead would break that", () => {
    // The failure mode stated directly, so the reason for the diff is not
    // lost the next time someone simplifies this.
    const kit = { defaultCornerRadius: 30 };
    const before = settingsFromBrandKit(kit);
    const naive = { ...before };                      // every field written

    const after = settingsFromBrandKit({ defaultCornerRadius: 4 });
    expect(applyOverride(after, naive).cornerRadius).toBe(30); // stuck
    expect(applyOverride(after, overrideFromSettings(before, before)).cornerRadius).toBe(4);
  });
});

describe("resetting a video to the defaults", () => {
  it("nulls every field, so nothing is left overridden", () => {
    const out = emptyOverride();
    expect(overriddenKeys(out)).toEqual([]);
    expect(applyOverride(base, out)).toEqual(base);
  });

  it("covers exactly the same fields the diff writes", () => {
    // If these two lists drifted, a reset would leave some fields overridden
    // with no way to clear them from the UI.
    const diffKeys = Object.keys(overrideFromSettings(base, { ...base })).sort();
    expect(Object.keys(emptyOverride()).sort()).toEqual(diffKeys);
  });
});
