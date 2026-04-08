import { type Express } from "express";
import { storage } from "./storage";
import { hashPassword, verifyPassword } from "./auth";
import { sendVerificationEmail, isEmailConfigured } from "./emailService";
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

    const validCode = process.env.ACCESS_CODE;
    const hasFreeAccess = !!(validCode && accessCode && accessCode.trim() === validCode);

    const existing = await storage.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hashed = await hashPassword(password);
    const username = email.split("@")[0] + "_" + Date.now();

    // Generate verification token (24h expiry)
    const verificationToken = crypto.randomUUID();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await storage.createUser({
      username,
      password: hashed,
      email,
      displayName,
      role,
      freeAccess: hasFreeAccess,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
    } as any);

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

export async function seedAdminAccount() {
  if (process.env.NODE_ENV === "production" && !process.env.SEED_ADMIN_ACCOUNT) {
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
