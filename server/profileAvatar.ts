/**
 * Which avatar an account should have after a profile save (client, 17 Nov
 * 2026: "updated my profile photo in Settings ... not showing top left").
 *
 * Settings saves the photo to the profile row (profile_media_url), while the
 * sidebar, the phone menu and the creator cards read users.avatar_url. This
 * maps one onto the other:
 *   - an image saved: it becomes the avatar
 *   - the photo removed (empty): the avatar is cleared
 *   - a video saved, or the photo not part of this save: no change
 * Returns the new avatar, or undefined when the avatar should stay as it is.
 */
export function avatarFromProfileMedia(
  saved: { profileMediaUrl?: string | null; profileMediaType?: string | null },
  current: string | null,
): string | null | undefined {
  if (saved.profileMediaUrl === undefined) return undefined;
  const url = (saved.profileMediaUrl ?? "").trim();
  if (!url) return current === null ? undefined : null;
  if ((saved.profileMediaType ?? "image") !== "image") return undefined;
  if (!/^https:\/\//i.test(url)) return undefined;
  return url === current ? undefined : url;
}
