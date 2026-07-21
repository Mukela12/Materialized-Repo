import { describe, it, expect } from 'vitest';
import {
  computeHmac,
  verifyStoreHmac,
  extractShopifyAttribution,
  extractWooAttribution,
} from '../../server/storeWebhooks';

const secret = 'shhh-secret';
const body = Buffer.from(JSON.stringify({ id: 123, total_price: '100.00' }));

describe('verifyStoreHmac', () => {
  it('accepts a correct signature (Buffer body)', () => {
    expect(verifyStoreHmac(body, computeHmac(body, secret), secret)).toBe(true);
  });

  it('accepts a correct signature (string body)', () => {
    const s = body.toString('utf8');
    expect(verifyStoreHmac(s, computeHmac(s, secret), secret)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(verifyStoreHmac(body, computeHmac(body, secret), 'other-secret')).toBe(false);
  });

  it('rejects a tampered body', () => {
    const sig = computeHmac(body, secret);
    expect(verifyStoreHmac(Buffer.from('{"id":123,"total_price":"999.00"}'), sig, secret)).toBe(false);
  });

  it('rejects missing inputs', () => {
    expect(verifyStoreHmac(undefined, 'x', secret)).toBe(false);
    expect(verifyStoreHmac(body, undefined, secret)).toBe(false);
    expect(verifyStoreHmac(body, computeHmac(body, secret), undefined)).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    expect(verifyStoreHmac(body, 'clearly-not-the-hmac', secret)).toBe(false);
  });
});

describe('extractShopifyAttribution', () => {
  it('reads the ref from note_attributes', () => {
    const a = extractShopifyAttribution({
      id: 55, total_price: '80.00',
      note_attributes: [{ name: 'mtrlzd_ref', value: 'CODE1' }],
    });
    expect(a).toEqual({ externalOrderId: '55', ref: 'CODE1', amount: '80.00' });
  });

  it('falls back to the landing_site query (mtrlzd_ref)', () => {
    const a = extractShopifyAttribution({
      id: 7, total_price: '10.00',
      landing_site: '/products/x?utm_source=materialized&mtrlzd_ref=CODE2',
    });
    expect(a.ref).toBe('CODE2');
  });

  it('falls back to utm_campaign', () => {
    const a = extractShopifyAttribution({ id: 7, total_price: '10.00', landing_site: '/x?utm_campaign=CODE3' });
    expect(a.ref).toBe('CODE3');
  });

  it('returns a null ref when unattributed, keeping the amount', () => {
    const a = extractShopifyAttribution({ id: 7, total_price: '10.00' });
    expect(a.ref).toBeNull();
    expect(a.amount).toBe('10.00');
    expect(a.externalOrderId).toBe('7');
  });
});

describe('extractWooAttribution', () => {
  it('reads the ref from meta_data and total', () => {
    const a = extractWooAttribution({ id: 900, total: '42.00', meta_data: [{ key: 'mtrlzd_ref', value: 'CODEW' }] });
    expect(a).toEqual({ externalOrderId: '900', ref: 'CODEW', amount: '42.00' });
  });

  it('handles a missing ref', () => {
    const a = extractWooAttribution({ id: 900, total: '42.00' });
    expect(a.ref).toBeNull();
  });
});
