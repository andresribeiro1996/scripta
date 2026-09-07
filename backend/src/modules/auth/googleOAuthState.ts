// The actual CSRF check behind plugin.ts's checkStateFunction.
//
// @fastify/oauth2 v8 rejects registration outright if generateStateFunction
// is given without a checkStateFunction (its `!a ^ !b` guard) — plugin.ts
// supplies generateStateFunction to stash this flow's PKCE challenge and
// mobile redirect target (see googleOAuthFlow.ts), so it must supply a real
// checkStateFunction too, not a stub. This is equivalent to the library's
// own unexported defaultCheckStateFunction: the callback's `state` query
// param must equal the value the SAME start request's redirect-state cookie
// holds. Pulled out as a pure function — no Fastify, no cookies — so this
// exact comparison is unit-testable on its own; see plugin.ts for how it's
// wired to the real request/cookie.
//
// NEVER replace the caller of this with `checkStateFunction: () => true` —
// that satisfies @fastify/oauth2's registration guard but throws away the
// entire CSRF protection checkStateFunction exists to provide.
export function isValidGoogleOAuthState(state: string | undefined, stateCookie: string | undefined): boolean {
  return typeof stateCookie === "string" && stateCookie.length > 0 && state === stateCookie;
}
