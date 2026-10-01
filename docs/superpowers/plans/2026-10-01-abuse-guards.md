# Abuse guards: implementation plan

> **For agentic workers:** implement task by task, verify each, commit each task separately. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the cheap ways one caller can freeze or flood the backend:
anonymous 10 MiB parses on `PUT /library`, spoofable client IPs, and
unthrottled routes that do whole-library work.

**Spec:** `docs/superpowers/specs/2026-10-01-load-safety-design.md`,
workstream 1.

**Rules:** root `AGENTS.md` and `backend/AGENTS.md`. No code comments. API
changes additive only. New `*.test.ts` files go into `backend/package.json`'s
`test` list. Verify with:

```
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend
npm test --workspace backend
```

---

## Task 1: Check auth before reading the body of `PUT /library`

**Files:** `backend/src/modules/library/routes.ts`,
`backend/src/modules/library/routes.test.ts`.

Today `PUT /library` runs `authGuard` as a `preHandler`. Fastify parses the
body (up to `LIBRARY_BODY_LIMIT_BYTES`) before `preHandler`, so anyone can
make the server parse a 10 MiB JSON body without an account.

- [ ] Write the failing test first: `PUT /library` with no `Authorization`
  header and a body that is **invalid JSON** must return `401`. Today it
  returns `400` (the parser runs first), which proves the body was read.
- [ ] Run `authGuard` as the route's `onRequest` hook instead of
  `preHandler`. `authGuard` reads only headers, so it works unchanged there.
- [ ] Existing tests for `PUT /library` (413 handling, validation, conflict)
  still pass.

## Task 2: One rate-limit key for signed-in and anonymous callers

**Files:** `backend/src/modules/auth/guard.ts`,
`backend/src/modules/auth/index.ts`, a test next to the guard's existing tests
(`backend/src/modules/auth/plugin.test.ts` or `routes.test.ts`, whichever
already tests the guard).

- [ ] Add and export `rateLimitKey(request)`: `user:<id>` when
  `getOptionalAuthenticatedUser(request)` finds a valid token, otherwise
  `request.ip`.
- [ ] Test: a valid token gives `user:<id>`, a missing or invalid token gives
  the IP.

`@fastify/rate-limit` runs its check in `onRequest`, before `authGuard`, so
the key cannot rely on `request.user`.

## Task 3: Rate limits on the unthrottled heavy routes

Each limit is its own `app.register(async (scoped) => { … })` scope with
`fastifyRateLimit` registered first and `keyGenerator: rateLimitKey`, the
same scoping pattern the modules already use (for example
`/community/people/suggested` in `community/routes.ts`). Routes in one scope
share one counter per key; separate scopes count separately.

| Scope | Routes | Limit |
|---|---|---|
| library writes | `PUT /library`, `POST /library/books`, `POST /library/books/merge`, `POST /library/share`, `POST /library/unshare` | 30 / minute |
| library read | `GET /library` | 60 / minute |
| dashboard | `GET /community/dashboard` | 60 / minute |
| people search | `GET /community/people` | 60 / minute |
| arena list | `GET /arenas/public` | 30 / minute |

All five library routes listed parse the stored document, which is why share
and unshare are in the writes scope.

**Files:** `backend/src/modules/library/routes.ts`,
`backend/src/modules/community/routes.ts`, `backend/src/modules/arena/routes.ts`
(and `arena/plugin.ts` if the public list must move scope), their `*.test.ts`.

- [ ] Library: restructure `buildLibraryRoutes` into the two scopes above.
  Keep the existing import-preview scope (10/min) and
  `sweepStaleImportDirs` as they are. Keep every route's options (body limit,
  413 error handler, `onRequest: authGuard` from Task 1).
- [ ] Community: put the dashboard and people search in their own scopes.
  `backend/src/modules/community/routes.test.ts` (around line 352) asserts
  `/community/people` keeps working after the suggested limiter trips: that
  must still hold, since the scopes are separate.
- [ ] Arena: put `GET /arenas/public` in a 30/min scope.
- [ ] Tests, one per scope: the request after the limit returns `429`; a
  second user (different token) is not affected; for library, 30 writes
  exhaust the writes bucket while `GET /library` still answers.
- [ ] Check how both clients react to `429` on a library save
  (`frontend/src/hooks/useLibrary.ts`, `frontend/src/lib/saveLibraryUpdate.ts`,
  `mobile/src/features/library/hooks/useLibrary.ts`). Report whether either
  retries automatically; don't change client code in this plan.

## Task 4: Trust only known proxies

**Files:** new `backend/src/config/trustedProxies.ts`,
`backend/src/app.ts`, new `backend/src/config/trustedProxies.test.ts` (add to
the `test` list).

`trustProxy: true` trusts every `X-Forwarded-For` hop, so `request.ip`, the
key of every per-IP limit, is whatever the client writes. A numeric hop count
is not an option: Fastify 5.12 ignores `X-Forwarded-For` entirely for a
number (`lib/request.js`, "Fail closed").

- [ ] `trustedProxies.ts` exports one array: `"loopback"`, `"linklocal"`,
  `"uniquelocal"`, `"100.64.0.0/10"`, then Cloudflare's current ranges.
  Fetch them from `https://www.cloudflare.com/ips-v4` and
  `https://www.cloudflare.com/ips-v6` and paste them verbatim; put the source
  URLs and fetch date in the commit message.
- [ ] `app.ts`: both `Fastify(...)` calls use `trustProxy: TRUSTED_PROXIES`.
- [ ] Tests, building a bare `Fastify({ trustProxy: TRUSTED_PROXIES })` with
  one route returning `request.ip`, using `inject`'s `remoteAddress`:
  1. peer `10.0.0.5`, `X-Forwarded-For: 6.6.6.6, 203.0.113.9, 172.64.1.1`
     → `203.0.113.9` (spoofed entry ignored, Cloudflare hop skipped);
  2. peer `100.64.3.4`, `X-Forwarded-For: 203.0.113.9` → `203.0.113.9`;
  3. peer `203.0.113.50` (public, untrusted), `X-Forwarded-For: 6.6.6.6`
     → `203.0.113.50`;
  4. peer `::ffff:10.0.0.5` with a forwarded client → the client (IPv4-mapped
     peers must count as trusted). If this fails, add the mapped forms
     explicitly and say so in the report.

**Gate, do not merge without it:** Railway's edge must connect from inside
these ranges, or every client shares one rate-limit bucket. The user runs the
production peer check from the spec's conversation (`/proc/net/tcp*` peers on
the app's port) and the peers must all be private, CGNAT or loopback. The
implementer stops after committing this task and reports; the merge waits.

## Task 5: Correct the README

- [ ] `backend/README.md`, "Security notes": the 20/min auth limit covers every
  `/auth` route in the auth plugin's scope, not only signup, login, refresh
  and logout. Add one line under the library and community sections naming
  the new limits.

## Done when

- All tasks committed separately; build, typecheck and backend tests pass.
- Report: test counts, the client 429 behaviour found in Task 3, and the
  Task 4 gate as still open.
