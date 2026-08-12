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
 *     drew bottom-centre and the client concluded the option did not exist;
 *   - when the panel became colourable, one copy was updated and the other kept
 *     `rgba(0,0,0,…)` hard-coded, so choosing a colour appeared to do nothing.
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

  /**
   * COMMERCE OFF. The client's rule: nothing over the video during playback,
   * and a product list at the end instead. The preview has to show that
   * difference, or switching it off looks like it did nothing at all.
   */
  if (!settings.commerceEnabled) {
    return (
      <div
        className="absolute inset-0 flex items-end justify-center p-3 pointer-events-none"
        data-testid={`${testId}-commerce-off`}
      >
        <div
          className="w-full max-w-[260px] p-2 space-y-1"
          style={{
            backgroundColor: panelBackground(settings),
            borderRadius: `${settings.cornerRadius}px`,
          }}
        >
          <p
            className="uppercase tracking-wide"
            style={{ color: settings.brandTitleColor, opacity: 0.75, fontSize: px(9) }}
          >
            Shown at the end of the video
          </p>
          {[1, 2].map((n) => (
            <div key={n} className="flex items-center justify-between gap-2">
              <span
                className="truncate"
                style={{
                  color: settings.productTitleColor,
                  fontFamily: fontStack(settings.titleFont),
                  fontSize: px(10 * (settings.titleFontSize / 100)),
                }}
              >
                Product {n}
              </span>
              <span
                className="shrink-0 px-2 py-0.5 font-medium"
                style={{
                  backgroundColor: buttonBackground(settings),
                  color: settings.buttonTextColor,
                  borderRadius: `${settings.buttonCornerRadius}px`,
                  fontFamily: fontStack(settings.buttonFont),
                  fontSize: px(8 * (settings.buttonFontSize / 100)),
                }}
              >
                {settings.buttonLabel}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`p-2 flex gap-2 ${
        // Her rule: side positions stack, top and bottom run side by side. A
        // row pinned to the left edge would span the video and cover the thing
        // being sold.
        isStackedPosition(settings.position)
          ? "flex-col items-stretch max-w-[150px]"
          : "flex-row items-center max-w-[260px]"
      }`}
      style={{
        ...carouselPositionStyles(settings.position, settings.positionOffsetX, settings.positionOffsetY),
        backgroundColor: panelBackground(settings),
        borderRadius: `${settings.cornerRadius}px`,
      }}
      data-testid={testId}
    >
      {settings.showThumbnail && (
        <div
          className="bg-background/50 rounded flex items-center justify-center flex-shrink-0"
          style={{ width: px(32), height: px(32) }}
        >
          <div className="bg-primary/20 rounded" style={{ width: px(20), height: px(20) }} />
        </div>
      )}

      <div className="flex-1 min-w-0">
        {/* The brand name — what brandTitleColor colours. Previously the
            carousel showed no brand line at all, so that control had nothing
            of its own to affect and had been pointed at the price instead. */}
        {settings.showTitle && (
          <p
            className="truncate uppercase tracking-wide"
            style={{
              color: settings.brandTitleColor,
              opacity: 0.85,
              fontFamily: fontStack(settings.titleFont),
              fontSize: px(8 * (settings.titleFontSize / 100)),
            }}
          >
            Brand Name
          </p>
        )}
        {settings.showTitle && (
          <p
            className="font-medium truncate"
            style={{
              color: settings.productTitleColor,
              fontFamily: fontStack(settings.titleFont),
              fontSize: px(12 * (settings.titleFontSize / 100)),
            }}
          >
            Product Name
          </p>
        )}
        {settings.showPrice && (
          <p
            style={{
              // The price sits with the product, so it follows the product
              // title's colour. Binding it to brandTitleColor is what made
              // "Brand title colour" appear to control the price.
              color: settings.productTitleColor,
              opacity: 0.8,
              fontSize: px(10 * (settings.priceFontSize / 100)),
            }}
          >
            $99.00
          </p>
        )}
      </div>

      {settings.showButton && (
        <button
          type="button"
          className="px-2 py-1 flex-shrink-0 font-medium transition-colors"
          style={{
            // Hovering is the only way to judge a hover colour, so the mock-up
            // is genuinely hoverable rather than showing a static swatch.
            backgroundColor: hovered ? settings.buttonHoverColor : buttonBackground(settings),
            color: settings.buttonTextColor,
            borderRadius: `${settings.buttonCornerRadius}px`,
            fontFamily: fontStack(settings.buttonFont),
            fontSize: px(9 * (settings.buttonFontSize / 100)),
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          data-testid={`${testId}-cta`}
        >
          {settings.buttonLabel}
        </button>
      )}
    </div>
  );
}
