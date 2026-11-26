import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  winkConfig, isWinkSlug, winkBookingUrl, formatFromPrice, fromPriceLabel, winkImageUrl,
  hotelFromSearchResult, hotelFromDestination, cityFromDestination, hotelOverlayFields,
} from '../../server/integrations/wink/winkHotels';
import { parsePriceToCents } from '../../server/inVideoCheckout';

const full = {
  WINK_CLIENT_ID: 'id', WINK_CLIENT_SECRET: 'secret',
  WINK_ACCOUNT_ID: 'acct', WINK_CUSTOMIZATION_ID: 'cust-123',
} as NodeJS.ProcessEnv;

describe('WINK config', () => {
  it('is off until all four values are set', () => {
    expect(winkConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(winkConfig({ ...full, WINK_CUSTOMIZATION_ID: ' ' })).toBeNull();
    expect(winkConfig(full)).not.toBeNull();
  });

  it('uses staging unless WINK_ENV is production', () => {
    expect(winkConfig(full)!.bookHost).toBe('https://staging-book.wink.travel');
    expect(winkConfig({ ...full, WINK_ENV: 'prod' })!.env).toBe('staging');
    const live = winkConfig({ ...full, WINK_ENV: 'production' })!;
    expect(live.bookHost).toBe('https://book.wink.travel');
    expect(live.partnerHost).toBe('partner.wink.travel:443');
    expect(live.tokenUrl).toBe('https://iam.wink.travel/oauth2/token');
  });
});

describe('booking link', () => {
  it('carries our customization id so WINK credits the booking', () => {
    const url = new URL(winkBookingUrl(winkConfig(full)!, 'traveligo-hotel-bangkok-thailand'));
    expect(url.origin).toBe('https://staging-book.wink.travel');
    expect(url.pathname).toBe('/hotel/traveligo-hotel-bangkok-thailand');
    expect(url.searchParams.get('cid')).toBe('cust-123');
  });

  it('only accepts WINK slugs', () => {
    expect(isWinkSlug('hotel-wink')).toBe(true);
    for (const bad of ['', 'a', '../admin', 'Hotel-Wink', 'x/y', 'a--b', '-a', 'a b', 'javascript:alert(1)', null, 5]) {
      expect(isWinkSlug(bad)).toBe(false);
    }
    expect(() => winkBookingUrl(winkConfig(full)!, '../x')).toThrow();
  });
});

describe('hotel cards from WINK search results', () => {
  const result = {
    urlName: 'hotel-wink', name: 'Hotel <b>Wink</b>', starRating: 5, commission: 0.1,
    heroImageUrl: 'https://staging-cdn.wink.travel/img/x?w={size}&f=jpg',
    city: { name: 'Bangkok' }, asLowAs: 450000,
    currency: { currencyCode: 'THB', currencyExponent: 2, fxQuotes: [{ currencyCode: 'USD', rate: '0.0315' }] },
  };

  it('converts to dollars with WINK\'s quote, rounding up', () => {
    // 4,500 THB x 0.0315 = 141.75 -> from $142
    expect(hotelFromSearchResult(result)!.fromPrice).toBe('from $142');
  });

  it('keeps the hotel currency when there is no USD quote', () => {
    expect(fromPriceLabel(90000, { currencyCode: 'THB', currencyExponent: 2, fxQuotes: [] })).toBe('from 900 THB');
    expect(fromPriceLabel(12000, { currencyCode: 'USD', currencyExponent: 2 })).toBe('from $120');
    expect(formatFromPrice(0, 'USD', 2)).toBeNull();
    expect(formatFromPrice(100, 'usd', 2)).toBeNull();
  });

  it('reads commission as a fraction and fills in the image width', () => {
    const h = hotelFromSearchResult(result)!;
    expect(h.commissionPct).toBe(10);
    expect(h.imageUrl).toBe('https://staging-cdn.wink.travel/img/x?w=640&f=jpg');
    expect(winkImageUrl('http://insecure.example/x.jpg')).toBeNull();
  });

  it('strips markup from names', () => {
    expect(hotelFromSearchResult(result)!.name).toBe('Hotel bWink/b');
  });

  it('skips results without a slug or name', () => {
    expect(hotelFromSearchResult({ ...result, urlName: 'Bad Slug' })).toBeNull();
    expect(hotelFromSearchResult({ ...result, name: '  ' })).toBeNull();
  });

  it('reads hotels and cities from Lookup', () => {
    const d = { type: 'DESTINATION_TYPE_PROPERTY', urlName: 'rakyim', name: 'RakYim', cityName: 'Bangkok', countryName: 'Thailand' };
    expect(hotelFromDestination(d)).toMatchObject({ urlName: 'rakyim', city: 'Bangkok', country: 'Thailand', imageUrl: null });
    expect(hotelFromDestination({ ...d, type: 'DESTINATION_TYPE_CITY' })).toBeNull();
    expect(cityFromDestination({ ...d, type: 'DESTINATION_TYPE_CITY', urlName: 'bangkok-thailand', name: 'Bangkok' }))
      .toEqual({ urlName: 'bangkok-thailand', name: 'Bangkok', country: 'Thailand' });
  });
});

describe('hotel carousel card', () => {
  const hotel = hotelFromSearchResult({
    urlName: 'hotel-wink', name: 'Hotel Wink', city: { name: 'Bangkok' }, asLowAs: 12000,
    currency: { currencyCode: 'USD', currencyExponent: 2 },
  })!;

  it('points at our redirect, not WINK, so the id stays on the server', () => {
    const f = hotelOverlayFields(hotel, 'https://www.mtrlzd.com/');
    expect(f.productUrl).toBe('https://www.mtrlzd.com/api/wink/book/hotel-wink');
    expect(f.productUrl).not.toContain('cid=');
    expect(f).toMatchObject({ buttonLabel: 'BOOK NOW', brandName: 'Bangkok', source: 'wink', price: 'from $120' });
  });

  it('is never chargeable in the video', () => {
    const f = hotelOverlayFields(hotel, 'https://www.mtrlzd.com');
    expect(f.priceCents).toBeNull();
    // and even the label would not parse as a price if it were re-derived
    expect(parsePriceToCents(f.price)).toBeNull();
  });
});

describe('vendored WINK protos', () => {
  it('are the three files the client loads, with the licence', () => {
    const dir = path.join(__dirname, '../../server/integrations/wink/proto');
    for (const f of ['partner_destination_lookup', 'partner_search', 'partner_common']) {
      expect(fs.existsSync(path.join(dir, `wink/partner/v1/${f}.proto`))).toBe(true);
    }
    expect(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8')).toContain('Apache License');
  });
});
