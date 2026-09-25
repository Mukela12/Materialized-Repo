/**
 * Arbitrary-timestamp frame extraction with ffmpeg, for videos on hosts that
 * have no frame-rendering URL API (Bunny Stream — Cloudinary renders frames by
 * URL transform and never needs this).
 *
 * ── Why this is cheap enough to run inline ────────────────────────────────────
 * Spiked 2026-09-06 against a 104MB remote original: ffmpeg seeks over HTTP
 * with Range requests — the trace showed it jumping straight to the tail
 * index — and lands a frame in ~4s. With ranges forbidden the same extraction
 * took 50.6s and failed, so range support on the source is the load-bearing
 * requirement; Bunny's MP4 fallback renditions are static faststart files,
 * which satisfy it better than the spike's own test case did.
 *
 * ── The binary ───────────────────────────────────────────────────────────────
 * ffmpeg arrives via nixpacks aptPkgs on Railway (see nixpacks.toml) and
 * homebrew locally. Its absence is checked ONCE and reported at boot — a
 * missing binary must be a deploy-log line, not a mystery inside the first
 * detection job weeks later. Extraction degrades to "no frames", which the
 * detection path already treats as fall-back-to-metadata.
 */
import { spawn } from "node:child_process";

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

let availability: Promise<string | null> | null = null;

/** The ffmpeg version line, or null when the binary is missing. Cached. */
export function ffmpegAvailable(): Promise<string | null> {
  availability ??= new Promise((resolve) => {
    try {
      const p = spawn(ffmpegPath(), ["-version"]);
      let out = "";
      p.stdout.on("data", (d) => { out += d; });
      p.on("error", () => resolve(null));
      p.on("close", (code) => resolve(code === 0 ? (out.split("\n")[0].trim() || "ffmpeg") : null));
    } catch {
      resolve(null);
    }
  });
  return availability;
}

/**
 * One JPEG frame at `timestamp` seconds from a remote video URL.
 *
 * `-ss` BEFORE `-i` is what makes this a seek instead of a decode-from-zero;
 * the output goes to stdout so no temp files are created or leaked. Throws on
 * a non-zero exit, a timeout, or output that is not a JPEG — callers treat a
 * throw as "skip this frame".
 */
export function extractFrameJpeg(
  url: string,
  timestamp: number,
  width = 640,
  timeoutMs = 30_000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner", "-loglevel", "error",
      "-ss", String(timestamp),
      "-i", url,
      "-frames:v", "1",
      "-vf", `scale=${Math.max(64, width)}:-2`,
      "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "4",
      "pipe:1",
    ];
    const p = spawn(ffmpegPath(), args);
    const chunks: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms at t=${timestamp}`));
    }, timeoutMs);

    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited ${code} at t=${timestamp}: ${err.slice(0, 300)}`));
      }
      // JPEG magic — an empty or garbage payload must not reach a vision model
      // pretending to be a frame.
      if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
        return reject(new Error(`ffmpeg produced ${buf.length} bytes that are not a JPEG at t=${timestamp}`));
      }
      resolve(buf);
    });
  });
}
