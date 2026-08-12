/**
 * The creator's Instagram handle, as it appears in a brand's inbox.
 *
 * The client: replace "by a creator" with "by [Creator_Instagram_Handle]".
 *
 * This is user-supplied text placed into an HTML email that MTRLZD sends on a
 * creator's behalf to a third party. A handle has no legitimate reason to
 * contain a bracket, a quote or a space, so it is restricted to what Instagram
 * itself permits rather than escaped — the narrower rule is the safer one, and
 * anything it strips was never a real handle.
 */
import { describe, it, expect } from "vitest";
import { formatCreatorHandle } from "../../server/emailService";

describe("formatting a handle", () => {
  it("adds the @, because it is stored without one", () => {
    expect(formatCreatorHandle("bethanie")).toBe("@bethanie");
  });

  it("does not double the @ when someone types it", () => {
    expect(formatCreatorHandle("@bethanie")).toBe("@bethanie");
    expect(formatCreatorHandle("@@bethanie")).toBe("@bethanie");
  });

  it("keeps the characters Instagram actually allows", () => {
    expect(formatCreatorHandle("beth.anie_01")).toBe("@beth.anie_01");
  });

  it("returns null when there is no handle, so the email can fall back", () => {
    // Printing "by @" would be worse than printing the display name.
    for (const v of ["", "   ", "@", null, undefined]) {
      expect(formatCreatorHandle(v)).toBeNull();
    }
  });

  it("strips anything that could become markup in the email", () => {
    for (const payload of [
      '<script>alert(1)</script>',
      'x" onmouseover="alert(1)',
      "beth</a><a href='//evil'>",
      "beth<img src=x onerror=alert(1)>",
    ]) {
      const out = formatCreatorHandle(payload);
      expect(out, `payload: ${payload}`).not.toMatch(/[<>"'`&\/\\ ]/);
    }
  });

  it("caps the length", () => {
    // Instagram's own limit is 30; a longer value is not a handle.
    expect(formatCreatorHandle("a".repeat(100))).toBe("@" + "a".repeat(30));
  });
});
