import { type Express } from "express";
import { storage } from "./storage";
import { hashPassword, verifyPassword } from "./auth";
import { checkRedeemable, grantsOf, normaliseCode } from "./vouchers";
import { sendVerificationEmail, sendPasswordResetEmail, isEmailConfigured } from "./emailService";
import { z } from "zod";
import crypto from "crypto";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(1),
  role: z.enum(["creator", "brand", "affiliate"]).default("creator"),
  accessCode: z.string().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6),
});

// SHA-256 hash of a reset token — we store only the hash at rest so a leaked
// database row can't be used to reset an account.
function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function registerAuthRoutes(app: Express) {
  // ── Login ────────────────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const { email, password } = parsed.data;
    const user = await storage.getUserByEmail(email);

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Check email verification (skip for admin accounts)
    if (!user.emailVerified && !user.isAdmin) {
      return res.status(403).json({
        error: "Please verify your email before logging in",
        needsVerification: true,
        email: user.email,
      });
    }

    (req.session as any).userId = user.id;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );

    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      isAdmin: user.isAdmin,
      avatarUrl: user.avatarUrl,
    });
  });

  // ── Logout ───────────────────────────────────────────────────────────────
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  // ── Register ─────────────────────────────────────────────────────────────
  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }

    const { email, password, displayName, role, accessCode } = parsed.data;

    const existing = await storage.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hashed = await hashPassword(password);
    const username = email.split("@")[0] + "_" + Date.now();

    // Generate verification token (24h expiry)
    const verificationToken = crypto.randomUUID();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    /**
     * Voucher validation happens BEFORE the account is created, so a bad code
     * can be reported instead of silently producing an ordinary account.
     *
     * The old behaviour compared one env-var string and, on a mismatch, created
     * the account anyway with no free access and no message. A creator handed a
     * voucher by their brand would type it, get a normal trial, and never learn
     * it had not worked — nor would the brand, until they asked why their people
     * had no access.
     *
     * ACCESS_CODE is still honoured as a fallback so existing shared codes keep
     * working through the transition, but it grants nothing a voucher does not.
     */
    let voucherGrants = { freeAccess: false, waiveSetupFee: false };
    let voucherToRedeem: { id: string; maxRedemptions: number | null } | null = null;

    if (accessCode && accessCode.trim()) {
      const code = normaliseCode(accessCode);
      const legacy = process.env.ACCESS_CODE;

      if (legacy && code === normaliseCode(legacy)) {
        voucherGrants = { freeAccess: true, waiveSetupFee: false };
      } else {
        const voucher = await storage.getVoucherByCode(code);
        // Count read for the message only; the CAP is enforced inside
        // redeemVoucher's transaction, where it cannot be raced.
        const check = checkRedeemable(voucher, { role, redemptionCount: 0 });
        if (!check.ok) {
          return res.status(400).json({ error: check.message, reason: check.reason });
        }
        voucherGrants = grantsOf(check.voucher);
        voucherToRedeem = { id: check.voucher.id, maxRedemptions: check.voucher.maxRedemptions };
      }
    }

    const user = await storage.createUser({
      username,
      password: hashed,
      email,
      displayName,
      role,
      freeAccess: voucherGrants.freeAccess,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
    } as any);

    if (voucherToRedeem) {
      // Now that the user row exists. If the last seat went to somebody else
      // between the check above and here, the account still exists but WITHOUT
      // the grant — reported honestly rather than quietly handing out seat 21.
      const r = await storage.redeemVoucher(voucherToRedeem.id, user.id, voucherToRedeem.maxRedemptions);
      if (!r.redeemed) {
        await storage.updateUser(user.id, { freeAccess: false } as any).catch(() => {});
        return res.status(409).json({
          error: r.reason === "exhausted"
            ? "That voucher was fully used moments ago. Your account was created, but without the voucher benefit."
            : "That voucher has already been used on this account.",
          reason: r.reason,
          accountCreated: true,
        });
      }
    }

    // Send verification email
    if (isEmailConfigured()) {
      const origin = req.headers.origin ?? `${req.protocol}://${req.headers.host}`;
      try {
        await sendVerificationEmail({
          email,
          displayName,
          verifyUrl: `${origin}/verify-email/${verificationToken}`,
        });
      } catch (err) {
        console.error("[Auth] Failed to send verification email:", err);
      }
    }

    res.status(201).json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      needsVerification: true,
    });
  });

  // ── Verify Email ─────────────────────────────────────────────────────────
  app.post("/api/auth/verify-email", async (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Verification token is required" });
    }

    // Find user by verification token
    const user = await storage.getUserByVerificationToken(token);
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired verification token" });
    }

    // Check expiry
    if (user.emailVerificationExpires && new Date(user.emailVerificationExpires) < new Date()) {
      return res.status(400).json({ error: "Verification token has expired. Please request a new one." });
    }

    // Mark as verified
    await storage.updateUser(user.id, {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    } as any);

    // Auto-login
    (req.session as any).userId = user.id;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );

    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      isAdmin: user.isAdmin,
      verified: true,
    });
  });

  // ── Resend Verification Email ────────────────────────────────────────────
  app.post("/api/auth/resend-verification", async (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await storage.getUserByEmail(email);
    if (!user) {
      // Don't reveal if user exists
      return res.json({ sent: true });
    }

    if (user.emailVerified) {
      return res.json({ sent: true, alreadyVerified: true });
    }

    // Generate new token
    const verificationToken = crypto.randomUUID();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await storage.updateUser(user.id, {
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
    } as any);

    if (isEmailConfigured()) {
      const origin = req.headers.origin ?? `${req.protocol}://${req.headers.host}`;
      try {
        await sendVerificationEmail({
          email: user.email,
          displayName: user.displayName,
          verifyUrl: `${origin}/verify-email/${verificationToken}`,
        });
      } catch (err) {
        console.error("[Auth] Failed to resend verification email:", err);
      }
    }

    res.json({ sent: true });
  });

  // ── Forgot Password (request reset) ──────────────────────────────────────
  app.post("/api/auth/forgot-password", async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "A valid email is required" });
    }

    const { email } = parsed.data;
    const user = await storage.getUserByEmail(email);

    // Never reveal whether an account exists — always return the same response.
    if (user) {
      // Generate a cryptographically random token; store only its SHA-256 hash.
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(token);
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await storage.updateUser(user.id, {
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: expires,
      } as any);

      if (isEmailConfigured()) {
        const origin = req.headers.origin ?? `${req.protocol}://${req.headers.host}`;
        try {
          await sendPasswordResetEmail({
            email: user.email,
            displayName: user.displayName,
            resetUrl: `${origin}/reset-password/${token}`,
          });
        } catch (err) {
          console.error("[Auth] Failed to send password reset email:", err);
        }
      }
    }

    res.json({ sent: true });
  });

  // ── Reset Password (perform reset) ───────────────────────────────────────
  app.post("/api/auth/reset-password", async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    const { token, password } = parsed.data;
    const tokenHash = hashResetToken(token);

    const user = await storage.getUserByPasswordResetTokenHash(tokenHash);
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    // Check expiry
    if (user.passwordResetExpires && new Date(user.passwordResetExpires) < new Date()) {
      return res.status(400).json({ error: "Reset link has expired. Please request a new one." });
    }

    // Hash the new password and clear the reset token (single-use).
    const hashed = await hashPassword(password);
    await storage.updateUser(user.id, {
      password: hashed,
      passwordResetTokenHash: null,
      passwordResetExpires: null,
    } as any);

    // Do not auto-login — the user re-authenticates with the new password.
    res.json({ success: true });
  });

  // ── Get Current User ─────────────────────────────────────────────────────
  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      username: user.username,
      role: user.role,
      isAdmin: user.isAdmin,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
      stripeCustomerId: user.stripeCustomerId,
      stripeConnectAccountId: user.stripeConnectAccountId,
      stripeConnectOnboarded: user.stripeConnectOnboarded,
    });
  });
}

/**
 * Seed or re-sync the admin account.
 *
 * ⚠ THIS OVERWRITES THE ADMIN'S PASSWORD ON EVERY BOOT, which means every
 * deploy. The client reported "the admin logins were failing" and this was why:
 * she had set her own password, a deploy re-applied ADMIN_PASSWORD, and her
 * login stopped working with no explanation. Leave it off in production once the
 * account exists; it is a bootstrap tool, not a maintenance one.
 *
 * The flag is parsed EXPLICITLY rather than for truthiness. It used to be
 * `!process.env.SEED_ADMIN_ACCOUNT`, so setting SEED_ADMIN_ACCOUNT=false — the
 * obvious way to turn it off — left it switched ON, because "false" is a
 * non-empty string.
 */
function seedingEnabled(): boolean {
  const raw = (process.env.SEED_ADMIN_ACCOUNT ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function seedAdminAccount() {
  if (process.env.NODE_ENV === "production" && !seedingEnabled()) {
    return;
  }

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.log("[Auth] ADMIN_EMAIL/ADMIN_PASSWORD not set, skipping admin seed");
    return;
  }

  try {
    const existing = await storage.getUserByEmail(ADMIN_EMAIL);
    if (existing) {
      const hashed = await hashPassword(ADMIN_PASSWORD);
      await storage.updateUser(existing.id, { isAdmin: true, password: hashed, emailVerified: true } as any);
      console.log("[Auth] Admin account synced: " + ADMIN_EMAIL);
      return;
    }

    const hashed = await hashPassword(ADMIN_PASSWORD);
    await storage.createUser({
      username: "admin_" + Date.now(),
      password: hashed,
      email: ADMIN_EMAIL,
      displayName: "Admin",
      role: "creator",
      isAdmin: true,
      emailVerified: true,
    } as any);

    console.log("[Auth] Admin account created: " + ADMIN_EMAIL);
  } catch (err) {
    console.error("[Auth] Failed to seed admin account:", err);
  }
}
