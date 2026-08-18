/**
 * Publishing must refresh the lists it changes.
 *
 * ── The bug this exists for ──────────────────────────────────────────────────
 * The client sets `staleTime: Infinity` with refetchOnWindowFocus off, so a
 * query is fetched once per session and then never again unless something
 * invalidates it. handleSaveDraft invalidated ["/api/videos"]; handlePublish
 * did not.
 *
 * So publishing showed "Video Published!" and left My Campaigns exactly as the
 * user had last seen it — usually empty, because they had opened it before
 * uploading. The row was in the database and the file was on Cloudinary the
 * whole time. From the outside it was indistinguishable from the upload having
 * been thrown away, and it was reported as "the database and storage does not
 * work".
 *
 * It also looked intermittent, which is worse: land on the page fresh after
 * publishing and it works, because that is a first fetch rather than a stale
 * one.
 *
 * Source-read rather than rendered, because the defect is one missing call in a
 * handler and the assertion is simply that it is there.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(__dirname, "../../client/src/components/VideoUploadModal.tsx"),
  "utf8",
);

/** The body of a top-level `const handleX = async () => { ... }` in the modal. */
function handlerBody(name: string): string {
  const start = SRC.indexOf(`const ${name} = async () => {`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = SRC.indexOf("\n  const handle", start + 1);
  return SRC.slice(start, next === -1 ? SRC.length : next);
}

describe("VideoUploadModal caching", () => {
  it("publishing invalidates the campaigns list", () => {
    expect(handlerBody("handlePublish")).toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*\["\/api\/videos"\]/,
    );
  });

  it("publishing invalidates the global library it now appears in", () => {
    expect(handlerBody("handlePublish")).toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*\["\/api\/videos\/library"\]/,
    );
  });

  it("saving a draft still invalidates too", () => {
    expect(handlerBody("handleSaveDraft")).toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*\["\/api\/videos"\]/,
    );
  });

  /**
   * The reason the missing call was fatal rather than cosmetic. If these
   * defaults are ever relaxed, a stale list self-corrects and the assertions
   * above stop being load-bearing — but until then they are.
   */
  it("still relies on invalidation, because queries never go stale on their own", () => {
    const qc = readFileSync(join(__dirname, "../../client/src/lib/queryClient.ts"), "utf8");
    expect(qc).toMatch(/staleTime:\s*Infinity/);
    expect(qc).toMatch(/refetchOnWindowFocus:\s*false/);
  });
});
