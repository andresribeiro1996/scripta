// Task 4A — mobile Google sign-in against the same backend endpoints the
// web flow uses (backend/src/modules/auth/plugin.ts, routes.ts). Opens the
// backend's own GET /auth/google as an in-app browser session — an
// ASWebAuthenticationSession on iOS, a Custom Tab on Android, via
// expo-web-browser's openAuthSessionAsync — never this app's own WebView,
// so the OS's real cookie/credential store is used (the same reasoning
// the plan calls out for why the redirect target must be a real
// browser-level callback, not an in-process page). Google's own flow runs
// entirely inside that session; this app only ever sees the final
// redirect back to its own custom scheme, carrying the short-lived,
// single-use authorization code — never a token (see the global "never
// place access or refresh tokens in URLs" constraint).
//
// The redirect target sent as `redirect_target` is only ever a SELECTOR
// into the backend's own fixed MOBILE_OAUTH_REDIRECT_ALLOWLIST — the
// backend rejects anything not on that list outright (see
// mobileRedirectAllowlist.ts). This dev build uses a custom-scheme deep
// link (`scripta://oauth-redirect`, matching app.json's "scheme": "scripta")
// rather than an https App Link, per the plan's Task 4C note: universal
// links need a registered HTTPS origin that doesn't exist yet. Whoever
// deploys this build must add that exact string to
// MOBILE_OAUTH_REDIRECT_ALLOWLIST — see this task's handoff notes.
//
// KNOWN LIMITATION: Expo Go cannot exercise this flow. Its own redirect
// scheme is a per-launch `exp://<lan-ip>:<port>/--/...` URL that can never
// appear in a static server-side allowlist — this requires a development
// build (`expo run:ios` / `expo run:android` or an EAS dev client).

import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API_URL } from "../../core/config";
import { deriveCodeChallenge, generateCodeVerifier } from "./pkce";

export class GoogleSignInCancelledError extends Error {}

export interface GoogleAuthorizationCode {
  code: string;
  codeVerifier: string;
}

export async function startGoogleSignIn(): Promise<GoogleAuthorizationCode> {
  const redirectUri = Linking.createURL("oauth-redirect");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);

  const authUrl = new URL(`${API_URL}/auth/google`);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("redirect_target", redirectUri);

  const result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), redirectUri);

  if (result.type !== "success") {
    throw new GoogleSignInCancelledError("Google sign-in was cancelled.");
  }

  const code = new URL(result.url).searchParams.get("code");
  if (!code) {
    throw new Error("Google sign-in did not return an authorization code.");
  }

  return { code, codeVerifier };
}
