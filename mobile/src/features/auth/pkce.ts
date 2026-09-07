// RFC 7636 PKCE, client side — the mobile half of Task 4A's authorization
// code exchange (see backend/src/modules/auth/authorizationCode.ts). This
// app instance generates a verifier and derives its S256 challenge before
// starting /auth/google; the backend binds the one-time code it mints to
// that challenge, and this same verifier is the only thing that can claim
// the code later (see googleSignIn.ts). Without this, on Android any app
// registered for the same custom scheme could receive the redirect and
// exchange the code first.

import * as Crypto from "expo-crypto";

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** React Native has no built-in Buffer/btoa, so this avoids a base64
 *  dependency entirely: two concatenated UUIDs are 73 characters of
 *  `[0-9a-f-]`, well inside PKCE's required 43-128 character range and
 *  entirely within its unreserved verifier charset (`-._~` included). */
export function generateCodeVerifier(): string {
  return `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
}

/** code_challenge = BASE64URL(SHA256(ASCII(code_verifier))) — must match
 *  the backend's own s256Challenge in authorizationCode.ts exactly. */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const base64Digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64
  });
  return toBase64Url(base64Digest);
}
