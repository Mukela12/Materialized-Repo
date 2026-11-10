import { describe, it, expect } from 'vitest';
import { normaliseLinkUrl } from '../../shared/linkUrl';

describe('normaliseLinkUrl', () => {
  it('adds https:// to a typed domain', () => {
    expect(normaliseLinkUrl('www.one30m.co')).toBe('https://www.one30m.co/');
    expect(normaliseLinkUrl(' www.mtrlzd.com/register?role=creator ')).toBe('https://www.mtrlzd.com/register?role=creator');
  });
  it('keeps a full link as it is', () => {
    expect(normaliseLinkUrl('https://shop.example.com/p/1?a=b')).toBe('https://shop.example.com/p/1?a=b');
    expect(normaliseLinkUrl('http://example.com')).toBe('http://example.com/');
  });
  it('refuses anything that is not a web address', () => {
    expect(normaliseLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseLinkUrl('data:text/html,x')).toBeNull();
    expect(normaliseLinkUrl('not a link')).toBeNull();
    expect(normaliseLinkUrl('')).toBeNull();
    expect(normaliseLinkUrl(null)).toBeNull();
  });
});
