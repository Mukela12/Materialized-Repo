import { describe, it, expect } from 'vitest';
import { avatarFromProfileMedia } from '../../server/profileAvatar';

const img = 'https://res.cloudinary.com/x/image/upload/a.jpg';

describe('avatarFromProfileMedia', () => {
  it('a new image becomes the avatar', () => {
    expect(avatarFromProfileMedia({ profileMediaUrl: img, profileMediaType: 'image' }, null)).toBe(img);
    expect(avatarFromProfileMedia({ profileMediaUrl: img }, 'https://old/a.jpg')).toBe(img);
  });
  it('removing the photo clears the avatar', () => {
    expect(avatarFromProfileMedia({ profileMediaUrl: '' }, img)).toBeNull();
    expect(avatarFromProfileMedia({ profileMediaUrl: '' }, null)).toBeUndefined();
  });
  it('leaves the avatar alone for a video, a save without the photo, the same image, or a non-https link', () => {
    expect(avatarFromProfileMedia({ profileMediaUrl: img, profileMediaType: 'video' }, null)).toBeUndefined();
    expect(avatarFromProfileMedia({ bio: 'x' } as any, img)).toBeUndefined();
    expect(avatarFromProfileMedia({ profileMediaUrl: img }, img)).toBeUndefined();
    expect(avatarFromProfileMedia({ profileMediaUrl: 'blob:http://x/1' }, null)).toBeUndefined();
  });
});
