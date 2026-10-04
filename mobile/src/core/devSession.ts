import type { TokenStore } from "./tokenStore";

export async function recoverDevSession(
  tokenStore: Pick<TokenStore, "getRefreshToken">,
  { isDev, enabled }: { isDev: boolean; enabled: boolean },
  signIn: () => Promise<void>,
): Promise<boolean> {
  if (!isDev || !enabled || await tokenStore.getRefreshToken()) return false;
  await signIn();
  return true;
}
