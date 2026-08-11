/**
 * The playlist frame: defaults, inheritance and — mostly — the logo URL.
 *
 * A playlist embed runs on a publisher's own site and on whatever site they
 * paste it into. The logo is a publisher-supplied string that becomes an
 * `<img src>` there, which makes it the sharpest edge in this module.
 */
import { describe, it, expect } from "vitest";
import {
  PLAYLIST_STYLE_DEFAULTS, styleFromPlaylist, sanitisePlaylistStyle,
  safeImageUrl, isWatermark, logoPositionCss, LOGO_POSITIONS,
} from "../../shared/playlistStyle";

describe("the defaults", () => {
  it("gives every field a concrete value", () => {
    for (const [k, v] of Object.entries(PLAYLIST_STYLE_DEFAULTS)) {
      if (k === "logoUrl") continue; // legitimately null until one is set
      expect(v, `${k} has no default`).toBeDefined();
      expect(v, `${k} is null`).not.toBeNull();
    }
  });

  it("reproduces the look the embed already drew", () => {
    // A published playlist must not change appearance the day this ships.
    expect(PLAYLIST_STYLE_DEFAULTS.frameShow).toBe(true);
    expect(PLAYLIST_STYLE_DEFAULTS.frameBorderWidth).toBe(0);
    expect(PLAYLIST_STYLE_DEFAULTS.frameCornerRadius).toBe(12);
    expect(PLAYLIST_STYLE_DEFAULTS.playAutoplay).toBe(true);
  });
});

describe("reading a playlist row", () => {
  it("uses what is set and defaults what is not", () => {
    const s = styleFromPlaylist({ frameBorderWidth: 3, frameBorderColor: null });
    expect(s.frameBorderWidth).toBe(3);
    expect(s.frameBorderColor).toBe(PLAYLIST_STYLE_DEFAULTS.frameBorderColor);
  });

  it("treats a row that predates these columns as all-defaults", () => {
    expect(styleFromPlaylist({ id: 1, name: "Old" })).toEqual(PLAYLIST_STYLE_DEFAULTS);
    expect(styleFromPlaylist(null)).toEqual(PLAYLIST_STYLE_DEFAULTS);
  });

  it("does not read `false` as unset", () => {
    // Hiding the frame and turning off autoplay are the two things a publisher
    // is most likely to want; a truthiness check would make both impossible.
    const s = styleFromPlaylist({ frameShow: false, playAutoplay: false, audioShow: false });
    expect(s.frameShow).toBe(false);
    expect(s.playAutoplay).toBe(false);
    expect(s.audioShow).toBe(false);
  });
});

describe("the logo URL", () => {
  it("refuses every scheme that can execute", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "http://insecure.example/logo.png",
      "//evil.example/logo.png",
      "  javascript:alert(1)  ",
    ]) {
      expect(safeImageUrl(bad), `accepted: ${bad}`).toBeNull();
    }
  });

  it("refuses credentials in the authority", () => {
    // Embedding these on a third party's page leaks them into referrer logs
    // and makes a phishing host look like ours.
    expect(safeImageUrl("https://user:pass@example.com/logo.png")).toBeNull();
  });

  it("accepts an ordinary https image", () => {
    expect(safeImageUrl("https://cdn.example.com/logo.png"))
      .toBe("https://cdn.example.com/logo.png");
  });

  it("treats blank and non-strings as no logo", () => {
    for (const v of ["", "   ", null, undefined, 42, {}, [] as any]) {
      expect(safeImageUrl(v)).toBeNull();
    }
  });

  it("never returns a value beginning with anything but https", () => {
    // The property stated directly, rather than trusting the list above.
    for (const v of ["javascript:x", "data:x", "http://x/y", "https://x/y"]) {
      const out = safeImageUrl(v);
      if (out !== null) expect(out.startsWith("https://")).toBe(true);
    }
  });
});

describe("sanitising the whole style", () => {
  it("neutralises a hostile row", () => {
    const hostile: any = {
      frameBorderColor: "#000;} body{display:none} .x{",
      playButtonColor: "</style><script>alert(1)</script>",
      audioIconColor: "expression(alert(1))",
      frameBorderWidth: 9999,
      frameCornerRadius: -50,
      playButtonSize: 100000,
      audioIconOpacity: "abc",
      logoUrl: "javascript:alert(1)",
      logoPosition: "bottom-right;}#frame{opacity:0}",
    };
    const out = sanitisePlaylistStyle(hostile);

    for (const [k, v] of Object.entries(out)) {
      if (typeof v === "string") {
        expect(v, `${k} still has punctuation`).not.toMatch(/[{};<>()'"\\]/);
      }
    }
    // Her stated border range is 1–5pt; 9999 must not become a 9999pt border.
    expect(out.frameBorderWidth).toBe(5);
    expect(out.frameCornerRadius).toBe(0);
    expect(out.logoUrl).toBeNull();
    expect(LOGO_POSITIONS).toContain(out.logoPosition);
  });

  it("keeps a legitimate style intact", () => {
    const real = {
      frameShow: true, frameBorderWidth: 3, frameBorderColor: "#1f1b6d",
      frameCornerRadius: 24, playAutoplay: false, playButtonColor: "#ffffff",
      playButtonSize: 64, playButtonOpacity: 80, audioShow: true,
      audioIconColor: "#cfd8ea", audioIconSize: 24, audioIconOpacity: 70,
      logoUrl: "https://cdn.example.com/mark.png",
      logoPosition: "watermark-bottom-left" as const,
    };
    expect(sanitisePlaylistStyle(real)).toEqual(real);
  });
});

describe("logo placement", () => {
  it("recognises the watermark variants", () => {
    expect(isWatermark("watermark-bottom-left")).toBe(true);
    expect(isWatermark("bottom-left")).toBe(false);
  });

  it("gives every position a distinct placement", () => {
    // A watermark corner must land in the same corner as its plain twin — they
    // differ in opacity, not position.
    expect(logoPositionCss("watermark-top-left")).toBe(logoPositionCss("top-left"));
    const plain = ["top-left", "top-middle", "top-right", "bottom-left", "bottom-middle", "bottom-right"];
    expect(new Set(plain.map(logoPositionCss)).size).toBe(plain.length);
  });

  it("emits nothing that can escape a style attribute", () => {
    for (const p of LOGO_POSITIONS) {
      expect(logoPositionCss(p)).not.toMatch(/[<>"']/);
    }
  });
});
