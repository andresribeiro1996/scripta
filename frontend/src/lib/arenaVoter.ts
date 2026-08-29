// Anonymous voter identity for BookArena — a random UUID generated once
// per browser and persisted in localStorage, sent with every vote so a
// duel can enforce "one vote per voter" (backend's votes table UNIQUE
// constraint) without requiring an account. Not a security boundary —
// clearing storage gets a fresh token — see the design spec's own
// "Known simplifications" note (docs/superpowers/specs/2026-08-29-bookarena-design.md).

const STORAGE_KEY = "bookarena.voterToken";

/** In-memory fallback when localStorage isn't available — cached at
 *  module scope so getVoterToken() returns the SAME token on every call
 *  within one page load, not a fresh one each time. useArena.ts puts
 *  this token in its query key, so a fresh value on every call would
 *  change that key on every render and refetch forever. */
let memoryToken: string | null = null;

function randomToken(): string {
  // crypto.randomUUID() requires a secure context (https, or localhost) —
  // fall back to a plain random string on a plain-http origin, which is
  // exactly the kind of origin most likely to also hit the localStorage
  // catch below.
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getVoterToken(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = randomToken();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (private browsing, blocked site data) —
    // voting still works, it just won't be remembered as "already voted"
    // across a reload. Cache in memory so at least THIS page load is
    // stable — see memoryToken's own comment.
    if (!memoryToken) memoryToken = randomToken();
    return memoryToken;
  }
}
