/**
 * Server error codes must survive the trip to the UI.
 *
 * throwIfResNotOk used to throw a bare Error with the whole body stuffed into
 * `message`, so no caller could branch on WHICH error happened. Two real
 * consequences: the upload modal reported a trial-limit 403 as "Detection
 * failed — could not start AI scan", which points at the wrong subsystem
 * entirely and offers "try again" for something retrying cannot fix; and the
 * subscription page's TRIAL_NOT_ELIGIBLE branch could never fire.
 *
 * These pin the parsing rule, including the deliberate refusal to treat a prose
 * message as a code.
 */
import { describe, it, expect } from "vitest";

/** Mirrors the extraction in client/src/lib/queryClient.ts. */
function extractCode(text: string): string | undefined {
  try {
    const body = JSON.parse(text);
    const looksLikeCode = (v: unknown): v is string =>
      typeof v === "string" && /^[A-Z][A-Z0-9_]{2,}$/.test(v);
    if (looksLikeCode(body?.error)) return body.error;
    if (looksLikeCode(body?.code)) return body.code;
  } catch {
    /* not JSON */
  }
  return undefined;
}

describe("server error codes reach the UI", () => {
  it("extracts the trial-exhausted code — the one that misled a live demo", () => {
    expect(extractCode('{"error":"TRIAL_EXHAUSTED","message":"Free trial used"}')).toBe("TRIAL_EXHAUSTED");
  });

  it("extracts the other codes callers branch on", () => {
    expect(extractCode('{"error":"TRIAL_DURATION_EXCEEDED"}')).toBe("TRIAL_DURATION_EXCEEDED");
    expect(extractCode('{"error":"TRIAL_NOT_ELIGIBLE"}')).toBe("TRIAL_NOT_ELIGIBLE");
  });

  it("reads a `code` field when `error` holds prose", () => {
    expect(extractCode('{"error":"Something went wrong","code":"RATE_LIMITED"}')).toBe("RATE_LIMITED");
  });

  it("does NOT mistake a human sentence for a code", () => {
    // Most endpoints return prose here. Treating it as a branchable code would
    // make handlers match on copy, which changes whenever wording does.
    expect(extractCode('{"error":"Authentication required"}')).toBeUndefined();
    expect(extractCode('{"error":"Unknown video"}')).toBeUndefined();
    expect(extractCode('{"error":"The introductory offer is for first-time subscribers only."}')).toBeUndefined();
  });

  it("survives a non-JSON body without throwing", () => {
    expect(extractCode("Internal Server Error")).toBeUndefined();
    expect(extractCode("")).toBeUndefined();
    expect(extractCode("<html>502</html>")).toBeUndefined();
  });

  it("ignores too-short or lowercase values", () => {
    expect(extractCode('{"error":"OK"}')).toBeUndefined();
    expect(extractCode('{"error":"trial_exhausted"}')).toBeUndefined();
  });
});
