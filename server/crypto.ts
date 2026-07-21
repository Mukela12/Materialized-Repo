/**
 * Encryption for secrets at rest (store API tokens, etc.).
 *
 * Uses AES-256-GCM with a 32-byte key from ENCRYPTION_KEY (hex or base64).
 * Migration-safe:
 *   - encryptSecret() with no key configured returns the value unchanged (dev/legacy).
 *   - decryptSecret() returns any value not in the "enc:v1:" format unchanged, so
 *     existing plaintext rows keep working until they're next written.
 */
import crypto from "crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY || "";
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, raw.length === 64 ? "hex" : "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/** True if a valid 32-byte ENCRYPTION_KEY is configured. */
export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

/** Encrypt a secret for storage. No-op (returns input) if no key is configured. */
export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key || plain == null || plain === "") return plain;
  if (plain.startsWith(PREFIX)) return plain; // already encrypted
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt a stored secret. Returns legacy/plaintext values unchanged. */
export function decryptSecret(stored: string): string {
  if (stored == null || !stored.startsWith(PREFIX)) return stored;
  const key = getKey();
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required to decrypt an encrypted secret");
  }
  const [ivB, tagB, ctB] = stored.slice(PREFIX.length).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString("utf8");
}
