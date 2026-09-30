/**
 * What a carousel looks like, drawn from settings. One renderer, used by every
 * preview.
 *
 * ── Why this is extracted ────────────────────────────────────────────────────
 * There were two previews of the same object — one in the upload editor, one on
 * the Brand Kit page — each with its own copy of the markup. They drifted every
 * single time the carousel changed:
 *
 *   - the Brand Kit copy honoured two of the eight positions, so "bottom-right"
 *     drew bottom-center and the client concluded the option did not exist;
 *   - when the panel became colourable, one copy was updated and the other kept
 *     `rgba(0,0,0,…)` hard-coded, so choosing a color appeared to do nothing.
 *
 * Both times the setting saved correctly and only the picture was wrong, which
 * is the hardest kind of fault for a client to report: it looks like the
 * feature is missing rather than broken.
 *
 * A preview that lies is worse than no preview. So there is one of these.
 */
import { useState } from "react";
import {
  panelBackground, buttonBackground, isStackedPosition, type CarouselSettings,
} from "@shared/carousel";
import { carouselPositionStyles } from "@/lib/carouselPosition";
import { fontStack } from "@/lib/fonts";

export function CarouselMockup({
  settings,
  scale = 1,
  testId,
}: {
  settings: CarouselSettings;
  /** Larger previews want larger type; the layout is otherwise identical. */
  scale?: number;
  testId: string;
}) {
  const [hovered, setHovered] = useState(false);
  const px = (n: number) => `${n * scale}px`;

  /** The glass the player puts behind products, unless the panel is set fully clear. */
  const glass: React.CSSProperties = settings.backgroundOpacity > 0
    ? {
        backdropFilter: "blur(14px) saturate(1.5)",
        WebkitBackdropFilter: "blur(14px) saturate(1.5)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.09), 0 14px 32px -14px rgba(0,0,0,.6)",
      }
    : {};
  const brand = (text = "Brand") => settings.showTitle && (
    <p
      className="truncate uppercase"
      style={{
        color: settings.brandTitleColor, opacity: 0.62, fontWeight: 600, letterSpacing: ".12em",
        fontFamily: fontStack(settings.titleFont), fontSize: px(7 * (settings.titleFontSize / 100)),
      }}
    >
      {text}
    </p>
  );
  const name = (text: string, lines = 2) => settings.showTitle && (
    <p
      style={{
        color: settings.productTitleColor, fontWeight: 500, lineHeight: 1.25,
        fontFamily: fontStack(settings.titleFont), fontSize: px(9.5 * (settings.titleFontSize / 100)),
        display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines, overflow: "hidden",
        minHeight: lines === 2 ? "2.5em" : undefined, marginTop: px(3),
      }}
    >
      {text}
    </p>
  );
  const price = (text: string) => settings.showPrice && (
    <p
      style={{
        // The price sits with the product, so it follows the product
        // title's color. Binding it to brandTitleColor is what made
        // "Brand title color" appear to control the price.
        color: settings.productTitleColor, opacity: 0.9, fontWeight: 600, fontVariantNumeric: "tabular-nums",
        fontSize: px(9 * (settings.priceFontSize / 100)),
      }}
    >
      {text}
    </p>
  );
  const button = (first: boolean, fill = true) => settings.showButton && (
    <button
      type="button"
      className="flex items-center justify-center font-semibold uppercase whitespace-nowrap transition-colors"
      style={{
        // Hovering is the only way to judge a hover color, so the mock-up
        // is genuinely hoverable rather than showing a static swatch.
        backgroundColor: hovered && first ? settings.buttonHoverColor : buttonBackground(settings),
        color: settings.buttonTextColor,
        borderRadius: `${settings.buttonCornerRadius}px`,
        fontFamily: fontStack(settings.buttonFont),
        fontSize: px(7.5 * (settings.buttonFontSize / 100)),
        letterSpacing: ".08em", height: px(20), padding: `0 ${px(8)}`,
        width: fill ? "100%" : undefined, marginTop: fill ? px(6) : 0, flexShrink: 0,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.2), 0 1px 2px rgba(0,0,0,.3)",
      }}
      onMouseEnter={first ? () => setHovered(true) : undefined}
      onMouseLeave={first ? () => setHovered(false) : undefined}
      data-testid={first ? `${testId}-cta` : undefined}
    >
      {settings.buttonLabel}
    </button>
  );
  const thumb = (size: string, hue: number) => settings.showThumbnail && (
    <div
      className="flex-shrink-0 overflow-hidden"
      style={{
        width: size, aspectRatio: "1 / 1",
        borderRadius: `${Math.max(0, settings.cornerRadius - 7)}px`,
        background: `linear-gradient(145deg, hsl(${hue} 18% 78%), hsl(${hue} 14% 58%))`,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)",
      }}
    />
  );

  /**
   * COMMERCE OFF. The client's rule: nothing over the video during playback,
   * and a product list at the end instead. The preview has to show that
   * difference, or switching it off looks like it did nothing at all.
   */
  if (!settings.commerceEnabled) {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 pointer-events-none"
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,.6), rgba(0,0,0,.85))", zIndex: 10 }}
        data-testid={`${testId}-commerce-off`}
      >
        <p className="uppercase font-semibold" style={{ color: "rgba(255,255,255,.72)", letterSpacing: ".2em", fontSize: px(7.5) }}>
          Shop the video, shown at the end
        </p>
        {[0, 1].map((n) => (
          <div
            key={n}
            className="flex w-full max-w-[250px] items-center gap-2 p-1.5"
            style={{ background: "rgba(255,255,255,.07)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.09)", borderRadius: px(10) }}
          >
            {thumb(px(30), 20 + n * 140)}
            <div className="min-w-0 flex-1">
              {brand()}
              {name(n ? "Second product" : "Product name", 1)}
              {price(n ? "$149.00" : "$99.00")}
            </div>
            {button(n === 0, false)}
          </div>
        ))}
      </div>
    );
  }

  const stacked = isStackedPosition(settings.position);
  return (
    <div
      className={`flex ${stacked ? "flex-col" : "flex-row items-end"}`}
      style={{
        ...carouselPositionStyles(settings.position, settings.positionOffsetX, settings.positionOffsetY),
        backgroundColor: panelBackground(settings),
        borderRadius: `${settings.cornerRadius}px`,
        padding: px(5), gap: px(4),
        ...glass,
      }}
      data-testid={testId}
    >
      {/* The same card the player draws: square product shot, spaced brand,
          two-line name, price, slim button. Two sample products, so spacing
          and the dock's shape read as they will on the video. */}
      {[0, 1].map((n) => (
        <div key={n} className="flex flex-col" style={{ width: px(64), padding: px(3) }}>
          {thumb("100%", 20 + n * 140)}
          <div style={{ marginTop: settings.showThumbnail ? px(5) : 0 }}>
            {brand()}
            {name(n ? "Second product" : "Product name")}
            {price(n ? "$149.00" : "$99.00")}
          </div>
          {button(n === 0)}
        </div>
      ))}
    </div>
  );
}
