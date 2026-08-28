// Encrypt-at-rest for social platform tokens (AES-256-GCM). Nothing else
// in this app stores a third-party secret long-term — passwords are
// hashed (one-way, argon2, see modules/auth), never decrypted back — so
// this is genuinely new: an X/Instagram/Threads/TikTok/Bluesky token has
// to come back out in the clear to actually call that platform's API on
// the user's behalf, which a hash can't do. Hence real (reversible)
// encryption, gated behind SOCIALS_ENCRYPTION_KEY (see config/env.ts).

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the standard/recommended size for GCM

/** Stored as `iv:authTag:ciphertext`, each hex — one column, human-
 *  greppable-enough to spot in a DB browser without decoding, but not
 *  worth a JSON envelope for three fixed fields. */
export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(stored: string, keyHex: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted value — expected iv:authTag:ciphertext.");
  }
  const key = Buffer.from(keyHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
  return plaintext.toString("utf8");
}
