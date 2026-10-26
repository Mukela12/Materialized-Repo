/**
 * The Paris Creator Week claim form (client's design, 22 Oct 2026, ported from
 * her Replit copy). Shared so the page and the server check the same rules.
 */
import { z } from "zod";

const handle = z.string().trim().transform(value => value.replace(/^@+/, "").toLowerCase())
  .pipe(z.string().min(1, "Enter a handle.").max(30, "Use at most 30 characters.")
    .regex(/^[a-z0-9._]+$/, "Use a handle, not a link (letters, numbers, dots or underscores)."));

export const parisSignupSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your first name.").max(100),
  email: z.string().trim().email("Enter a valid email address.").max(254).transform(v => v.toLowerCase()),
  platform: z.enum(["instagram", "tiktok"]),
  creatorHandle: handle,
  friendHandle: handle,
  requestId: z.string().uuid().optional(),
}).superRefine((data, ctx) => {
  if (data.creatorHandle === data.friendHandle) {
    ctx.addIssue({ code: "custom", path: ["friendHandle"], message: "Enter a different handle for your friend." });
  }
  if (data.platform === "instagram") {
    for (const field of ["creatorHandle", "friendHandle"] as const) {
      if (data[field].startsWith(".") || data[field].endsWith(".") || data[field].includes("..")) {
        ctx.addIssue({ code: "custom", path: [field], message: "Instagram handles cannot start/end with a dot or contain consecutive dots." });
      }
    }
  }
});
