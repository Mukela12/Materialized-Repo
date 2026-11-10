import { describe, it, expect } from 'vitest';
import { CAROUSEL_DEFAULTS, sanitiseSettings, settingsFromBrandKit, overrideFromSettings, applyOverride } from '../../shared/carousel';
import { embedCarouselCss, widgetInlineStyles } from '../../server/embedCarousel';
import { cardMetrics } from '../../server/shareClip';

describe('Show Brand is its own toggle', () => {
  it('hides the brand line and keeps the product title', () => {
    const css = embedCarouselCss({ ...CAROUSEL_DEFAULTS, showBrand: false, showTitle: true });
    expect(css).toMatch(/\.product-brand\{[^}]*display:none/);
    expect(css).not.toMatch(/\.product-name\{[^}]*display:none/);
  });

  it('hides the product title and keeps the brand line', () => {
    const css = embedCarouselCss({ ...CAROUSEL_DEFAULTS, showBrand: true, showTitle: false });
    expect(css).toMatch(/\.product-name\{[^}]*display:none/);
    expect(css).not.toMatch(/\.product-brand\{[^}]*display:none/);
    expect(widgetInlineStyles({ ...CAROUSEL_DEFAULTS, showBrand: true, showTitle: false }).brand).not.toContain('display:none');
  });

  it('reads the brand kit default and stores a per-video change as an override', () => {
    expect(settingsFromBrandKit({ defaultShowBrand: false }).showBrand).toBe(false);
    const base = settingsFromBrandKit({});
    const o = overrideFromSettings(base, { ...base, showBrand: false });
    expect(o.showBrand).toBe(false);
    expect(applyOverride(base, o).showBrand).toBe(false);
  });
});

describe('carousel width', () => {
  it('defaults to 100% and is kept between 60% and 160%', () => {
    expect(sanitiseSettings({}).carouselWidth).toBe(100);
    expect(sanitiseSettings({ carouselWidth: 20 }).carouselWidth).toBe(60);
    expect(sanitiseSettings({ carouselWidth: 999 }).carouselWidth).toBe(160);
  });

  it('scales the cards in the embed, the widget and the downloaded clip', () => {
    expect(embedCarouselCss({ ...CAROUSEL_DEFAULTS, carouselWidth: 140 })).toContain('width:calc(var(--card-w,96px) * 1.4)');
    expect(widgetInlineStyles({ ...CAROUSEL_DEFAULTS, carouselWidth: 140 }).card).toContain('* 1.4)');
    const normal = cardMetrics(CAROUSEL_DEFAULTS, 390, 693).cardW;
    expect(cardMetrics({ ...CAROUSEL_DEFAULTS, carouselWidth: 140 }, 390, 693).cardW).toBeCloseTo(normal * 1.4);
  });
});
