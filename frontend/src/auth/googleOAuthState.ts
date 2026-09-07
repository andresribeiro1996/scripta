export const GOOGLE_OAUTH_STATE_KEY = "scripta_google_oauth_state";

export function createGoogleOAuthState(): string {
  const state = crypto.randomUUID();
  sessionStorage.setItem(GOOGLE_OAUTH_STATE_KEY, state);
  return state;
}

export function consumeGoogleOAuthState(state: string | null): boolean {
  const expected = sessionStorage.getItem(GOOGLE_OAUTH_STATE_KEY);
  sessionStorage.removeItem(GOOGLE_OAUTH_STATE_KEY);
  return state !== null && expected !== null && state === expected;
}
