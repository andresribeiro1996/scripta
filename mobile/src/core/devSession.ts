// Lets the app boot straight into a signed-in session against a local dev
// backend, for driving the app on an emulator without ever typing a
// password (see scripts/dev-account.mjs, which mints the token this reads
// and writes it to mobile/.env.local as EXPO_PUBLIC_DEV_REFRESH_TOKEN).
//
// `isDev`/`devToken` are passed in rather than read from `__DEV__`/
// `process.env` in here, so this stays plain-node testable (no RN
// globals) — auth.tsx's boot effect is the only caller, and it passes the
// real `__DEV__` global at the call site. That call site is what actually
// keeps this out of a release build: `__DEV__` is `false` there, and
// EXPO_PUBLIC_DEV_REFRESH_TOKEN is never set for an EAS build in the first
// place — either alone is enough to make seedDevSession a no-op.
import type { TokenStore } from "./tokenStore";

export async function seedDevSession(
  tokenStore: Pick<TokenStore, "getRefreshToken" | "setRefreshToken">,
  { isDev, devToken }: { isDev: boolean; devToken: string | undefined },
): Promise<void> {
  if (!isDev || !devToken) return;
  // Never clobber a real signed-in session — this only fills in a
  // completely empty store, e.g. right after installing the app.
  const existing = await tokenStore.getRefreshToken();
  if (existing) return;
  await tokenStore.setRefreshToken(devToken);
}

/** The other half of seedDevSession, for the case it deliberately refuses:
 *  a store holding a token that no longer works. Reseeding the dev fixture
 *  rebuilds the auth database, which leaves every token issued before it
 *  dead — and because the store is not empty, seedDevSession steps aside and
 *  the app lands on the login screen, looking like the dev account broke.
 *
 *  Call this ONLY after a refresh has actually failed: a session that can
 *  still refresh is a real one, including a fixture user signed in by hand
 *  to test something, and must survive. Returns whether the caller should
 *  retry the refresh. */
export async function recoverDevSession(
  tokenStore: Pick<TokenStore, "getRefreshToken" | "setRefreshToken">,
  { isDev, devToken }: { isDev: boolean; devToken: string | undefined },
): Promise<boolean> {
  if (!isDev || !devToken) return false;
  // Already the dev token: the failure is the backend's, not a stale store,
  // and writing it again would only buy an identical second failure.
  const existing = await tokenStore.getRefreshToken();
  if (existing === devToken) return false;
  await tokenStore.setRefreshToken(devToken);
  return true;
}
