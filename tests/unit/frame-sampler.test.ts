import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Cloudinary service so no real SDK/network is exercised. `cloudinary.url`
// is stubbed to emit the canonical transform URL shape we assert against, and
// `isCloudinaryConfigured` is toggled per-test.
const configured = { value: true };
vi.mock('../../server/cloudinaryService', () => ({
  isCloudinaryConfigured: () => configured.value,
  cloudinary: {
    url: (publicId: string, opts: Record<string, any>) =>
      `https://res.cloudinary.com/testcloud/video/upload/c_${opts.crop},q_${opts.quality},so_${opts.start_offset},w_${opts.width}/v1/${publicId}.jpg`,
  },
}));

import {
  parseCloudinaryVideoUrl,
  computeSampleTimestamps,
  sampleVideoFrames,
} from '../../server/frameSampler';

describe('parseCloudinaryVideoUrl', () => {
  it('parses publicId (folder + name) from a plain secure_url', () => {
    const parsed = parseCloudinaryVideoUrl(
      'https://res.cloudinary.com/dvj7ayoot/video/upload/v1700000000/materialized/videos/abc123.mp4'
    );
    expect(parsed?.publicId).toBe('materialized/videos/abc123');
    expect(parsed?.cloudName).toBe('dvj7ayoot');
  });

  it('drops a leading transformation segment', () => {
    const parsed = parseCloudinaryVideoUrl(
      'https://res.cloudinary.com/dvj7ayoot/video/upload/c_scale,so_3.5,w_640/v1/materialized/videos/abc123.mp4'
    );
    expect(parsed?.publicId).toBe('materialized/videos/abc123');
  });

  it('handles a URL with no version and no transforms', () => {
    const parsed = parseCloudinaryVideoUrl(
      'https://res.cloudinary.com/dvj7ayoot/video/upload/materialized/videos/xyz.webm'
    );
    expect(parsed?.publicId).toBe('materialized/videos/xyz');
  });

  it('treats a bare publicId (no scheme) as-is, stripping any extension', () => {
    expect(parseCloudinaryVideoUrl('materialized/videos/abc123')?.publicId).toBe(
      'materialized/videos/abc123'
    );
    expect(parseCloudinaryVideoUrl('materialized/videos/abc123.mp4')?.publicId).toBe(
      'materialized/videos/abc123'
    );
  });

  it('returns null for a non-Cloudinary host', () => {
    expect(parseCloudinaryVideoUrl('https://example.com/foo/bar.mp4')).toBeNull();
  });

  it('returns null for an image (wrong resource_type) URL', () => {
    expect(
      parseCloudinaryVideoUrl('https://res.cloudinary.com/dvj7ayoot/image/upload/v1/pic.jpg')
    ).toBeNull();
  });

  it('returns null for malformed / empty input', () => {
    expect(parseCloudinaryVideoUrl('')).toBeNull();
    expect(parseCloudinaryVideoUrl('not a url ://')).toBeNull();
  });
});

describe('computeSampleTimestamps', () => {
  it('spreads K frames at bucket midpoints for a normal duration', () => {
    // duration 20s, 4 frames -> midpoints of quarters: 2.5, 7.5, 12.5, 17.5
    expect(computeSampleTimestamps(20, 4)).toEqual([2.5, 7.5, 12.5, 17.5]);
  });

  it('never samples exactly at 0 or the final second', () => {
    const ts = computeSampleTimestamps(60, 4);
    expect(ts[0]).toBeGreaterThan(0);
    expect(ts[ts.length - 1]).toBeLessThan(60);
  });

  it('returns a single frame at 0 for unknown duration', () => {
    expect(computeSampleTimestamps(null, 4)).toEqual([0]);
    expect(computeSampleTimestamps(undefined, 4)).toEqual([0]);
    expect(computeSampleTimestamps(0, 4)).toEqual([0]);
    expect(computeSampleTimestamps(-5, 4)).toEqual([0]);
  });

  it('reduces frame count for a video shorter than K seconds', () => {
    // 3s video, want 4 frames -> integer seconds 0,1,2
    expect(computeSampleTimestamps(3, 4)).toEqual([0, 1, 2]);
  });

  it('dedupes timestamps', () => {
    const ts = computeSampleTimestamps(2, 8);
    expect(new Set(ts).size).toBe(ts.length);
  });
});

describe('sampleVideoFrames', () => {
  beforeEach(() => {
    configured.value = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns [] when Cloudinary is not configured (graceful fallback)', async () => {
    configured.value = false;
    const frames = await sampleVideoFrames(
      'https://res.cloudinary.com/dvj7ayoot/video/upload/v1/materialized/videos/a.mp4',
      { durationSeconds: 20 }
    );
    expect(frames).toEqual([]);
  });

  it('returns [] for a non-Cloudinary URL', async () => {
    const frames = await sampleVideoFrames('https://example.com/a.mp4', { durationSeconds: 20 });
    expect(frames).toEqual([]);
  });

  it('builds frame JPEG URLs without fetching when asBase64 is false', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    const frames = await sampleVideoFrames(
      'https://res.cloudinary.com/dvj7ayoot/video/upload/v1/materialized/videos/a.mp4',
      { durationSeconds: 20, count: 4, asBase64: false }
    );
    expect(frames).toHaveLength(4);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(frames[0].url).toContain('so_2.5');
    expect(frames[0].url).toContain('materialized/videos/a.jpg');
    expect(frames[0].mimeType).toBe('image/jpeg');
    expect(frames[0].base64).toBeUndefined();
  });

  it('fetches frames to base64 and skips failed fetches without throwing', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++;
        // First frame fails, the rest succeed.
        if (call === 1) return { ok: false, status: 404 } as any;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as any;
      })
    );

    const frames = await sampleVideoFrames(
      'https://res.cloudinary.com/dvj7ayoot/video/upload/v1/materialized/videos/a.mp4',
      { durationSeconds: 20, count: 4 }
    );

    // 4 requested, 1 failed -> 3 returned, each with base64.
    expect(frames).toHaveLength(3);
    for (const f of frames) {
      expect(f.base64).toBe(Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'));
    }
  });

  it('returns [] when every frame fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    const frames = await sampleVideoFrames(
      'https://res.cloudinary.com/dvj7ayoot/video/upload/v1/materialized/videos/a.mp4',
      { durationSeconds: 20, count: 4 }
    );
    expect(frames).toEqual([]);
  });
});
