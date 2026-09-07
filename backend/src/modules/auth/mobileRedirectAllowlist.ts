// Task 4A — the mobile Google OAuth redirect target must come from a
// FIXED server-side allowlist, never from a request parameter (see this
// module's plugin.ts and the global constraint in the migration plan).
// Pulled out as pure functions so the allowlist-enforcement rule itself is
// unit-testable without spinning up Fastify/oauth2.

/** MOBILE_OAUTH_REDIRECT_ALLOWLIST is comma-separated exact redirect
 *  targets (https App Link origins+paths, or a dev-only custom-scheme URL
 *  like "scripta://oauth-redirect") — see config/env.ts's own comment.
 *  Blank/whitespace-only entries are dropped so a trailing comma or an
 *  unset env var doesn't produce a surprise "" allowlist entry that would
 *  make an empty redirect_target pass. */
export function parseMobileRedirectAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Exact string match only — no origin-only comparison, since a bare
 *  custom-scheme entry (e.g. "scripta://oauth-redirect") has no
 *  meaningful "origin" separate from its full value, and allowing a
 *  matched-origin-different-path redirect would let a request parameter
 *  choose an arbitrary path on an otherwise-trusted origin. */
export function isAllowedRedirectTarget(target: string, allowlist: string[]): boolean {
  return allowlist.includes(target);
}
