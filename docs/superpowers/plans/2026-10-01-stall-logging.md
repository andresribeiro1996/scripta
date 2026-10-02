# Stall logging: implementation plan

> **For agentic workers:** implement task by task, verify each, commit each task separately. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Production logs name every request that blocks the event loop for
more than 200 ms, and every stall that happens outside a request, so the next
unbounded route shows up in Railway's logs instead of in users' lag.

**Spec:** `docs/superpowers/specs/2026-10-01-load-safety-design.md`,
workstream 2.

**Rules:** root `AGENTS.md` and `backend/AGENTS.md`. No code comments. About
a dozen lines of production code; no options beyond what the tests need. New
`*.test.ts` files go into `backend/package.json`'s `test` list. Verify with:

```
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend
npm test --workspace backend
```

---

## Task 1: Time every handler

**Files:** new `backend/src/stallLog.ts`, new `backend/src/stallLog.test.ts`,
`backend/src/app.ts`, `backend/package.json`.

- [ ] `stallLog.ts` exports `STALL_MS = 200` and
  `registerStallLog(app: FastifyInstance)`.
- [ ] `registerStallLog` adds an `onRoute` hook that replaces
  `routeOptions.handler` with a wrapper. The wrapper calls the original
  handler with the same `this`, `request` and `reply`, measures the time until
  that call returns with `performance.now()`, and returns the original
  result unchanged (a promise for async handlers). Over `STALL_MS` it logs
  through `request.log.warn({ method, route: routeOptions.url, blockedMs },
  "handler blocked the event loop")` with `blockedMs` rounded.
  - For an async handler this measures the synchronous part, up to its first
    `await`. That is exactly the part that blocks other requests.
  - Exceptions must propagate unchanged; time them too (use `finally`).
- [ ] `app.ts`: call `registerStallLog(app)` right after the `Fastify(...)`
  instance is created, before `/health` and before any `app.register`, so
  every route, including module routes, is wrapped.
- [ ] Tests with a bare Fastify instance and a log stream that collects
  lines (`Fastify({ logger: { stream } })`):
  1. a route that busy-waits 250 ms logs one warning naming its method and
     route, with `blockedMs >= 200`;
  2. a fast route logs nothing;
  3. an async handler that awaits a 300 ms timer but computes nothing logs
     nothing (waiting is not blocking);
  4. a throwing handler still returns a 500 and, if slow, still logs.

## Task 2: Catch stalls outside handlers

**Files:** `backend/src/stallLog.ts`, `backend/src/stallLog.test.ts`.

Body parsing, timers (arena sweep, cover worker) and startup work also block
the loop and are not handlers.

- [ ] In `registerStallLog`, create
  `monitorEventLoopDelay({ resolution: 20 })` from `node:perf_hooks`, enable
  it, and every 10 s (an unref'd `setInterval`) check `histogram.max`
  (nanoseconds). Over `STALL_MS` it logs
  `app.log.warn({ maxMs }, "event loop stalled")`; then `reset()`.
- [ ] An `onClose` hook clears the interval and disables the histogram, so
  tests and shutdown don't leak timers.
- [ ] Keep the per-tick check a small exported function that takes the
  histogram and the logger, so a test can call it with a fake histogram
  instead of waiting 10 s: over 200 ms logs once with `maxMs`, under logs
  nothing, both reset.

## Done when

- Both tasks committed; build, typecheck and backend tests pass.
- An existing app-level test that builds the real app (for example
  `backend/src/storage/filesRoute.test.ts` or any test calling `buildApp`)
  still passes, which shows module routes are wrapped without breaking them.
- Report the test counts and the final line count of `stallLog.ts`.
