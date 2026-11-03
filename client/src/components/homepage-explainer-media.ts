/**
 * The galaxy banner behind the homepage demos (client's Replit staging, 3 Nov
 * 2026), served from our own public folder rather than her Replit file store.
 * In media/ because top-level public/*.mp4 is kept out of git and Vercel for the
 * large source videos; this loop is 0.6 MB, and Safari needs the mp4.
 */
export const homepageExplainerMedia = {
  webm: "/media/homepage-explainer.webm",
  mp4: "/media/homepage-explainer.mp4",
  poster: "/creator-ecosystem-poster.webp",
};
