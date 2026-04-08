import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { type Request, type Response, type NextFunction } from "express";
import { storage } from "./storage";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [hashed, salt] = stored.split(".");
    if (!hashed || !salt) return false;
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    const hashedBuf = Buffer.from(hashed, "hex");
    return timingSafeEqual(buf, hashedBuf);
  } catch {
    return false;
  }
}

// ── Auth Middleware ─────────────────────────────────────────────────────────

/**
 * Require authenticated user. Attaches user to req.user.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = await storage.getUser(userId);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  (req as any).user = user;
  next();
}

/**
 * Require admin user. Must be used after requireAuth.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

/**
 * Require specific user role(s). Must be used after requireAuth.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: `Access restricted to ${roles.join(" or ")} accounts` });
    }
    next();
  };
}
