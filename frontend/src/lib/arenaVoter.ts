// Anonymous voter identity for BookArena — a random UUID generated once
// per browser and persisted in localStorage, sent with every vote so a
// duel can enforce "one vote per voter" (backend's votes table UNIQUE
// constraint) without requiring an account. Not a security boundary —
// clearing storage gets a fresh token — see the design spec's own
// "Known simplifications" note (docs/superpowers/specs/2026-08-29-bookarena-design.md).

const STORAGE_KEY = "bookarena.voterToken";

export function getVoterToken(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (private browsing, blocked site data) —
    // voting still works, it just won't be remembered as "already voted"
    // across a reload. Acceptable given this is already an
    // unenforceable-by-design anti-abuse measure, not a real one.
    return crypto.randomUUID();
  }
}
