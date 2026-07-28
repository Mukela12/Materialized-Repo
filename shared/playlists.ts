/**
 * WHEN A PLAYLIST'S CONTENTS FREEZE.
 *
 * Shared by the server guard (POST/DELETE /api/playlists/:id/items) and the client
 * that disables the buttons, so the two cannot drift into a state where the UI
 * offers something the API rejects — or worse, where only the UI enforces it.
 *
 * ── The defect this closes ───────────────────────────────────────────────────
 * A playlist is priced PER VIDEO and priced ONCE. POST /api/playlists/:id/items
 * had NO status guard, so:
 *
 *   1. create a 1-video playlist, pay 1 token (or by card) → published
 *   2. POST 99 more listingIds → 200 OK, zero extra charge
 *
 * and it stays that way, because /checkout refuses to run again on a published
 * playlist. 100 licences for the price of 1. The card path was no better: its
 * item-count check runs only at /confirm-payment, i.e. after the PaymentIntent is
 * already sized.
 *
 * `draft` is the only editable state. A draft can be re-checked-out at the new
 * price, which is exactly what the per-video pricing assumes.
 */
export const PLAYLIST_LOCKED_STATUSES = ["published", "pending_payment"] as const;

export type PlaylistLockedStatus = (typeof PLAYLIST_LOCKED_STATUSES)[number];

/**
 * True once money is committed against a specific video count.
 *
 * `published`       — paid for and live.
 * `pending_payment` — a PaymentIntent exists, sized at /checkout for N videos.
 *                     Adding here is not free money (confirm-payment re-checks the
 *                     count) but it turns a completed payment into a permanent 402,
 *                     which is a worse outcome for the user than refusing the add.
 */
export function isPlaylistLocked(status: string | null | undefined): boolean {
  return (PLAYLIST_LOCKED_STATUSES as readonly string[]).includes(status ?? "");
}

/** The message shown to the user. One wording, server and client. */
export function playlistLockedMessage(status: string | null | undefined): string {
  return status === "published"
    ? "This playlist is already published — its licence is paid. Create a new playlist to license more videos."
    : "This playlist has a payment in progress, so its videos are locked. Finish or cancel it before changing what it contains.";
}
