---
name: diagnosing-bugs
description: Loop-first diagnosis for a hard Scripta bug or performance regression — build a command that goes red on the bug before forming any theory. Use when the user says "diagnose" or "debug this", when a first fix didn't stick, or when a bug is flaky or only shows on a device.
---

# Diagnosing bugs

A discipline for hard bugs. Skip a phase only when you can say why.

Redact every secret in what you show — tokens, cookies, `Authorization` headers, OAuth codes, share-link slugs. Write `<REDACTED>`. Keep credentials in env vars so loops never echo them.

## 1. Build a feedback loop

This is the skill. With a **tight** command that goes **red** on this bug, bisection and hypothesis-testing are mechanical. Without one, reading code won't save you. Spend disproportionate effort here.

Reach for, roughly in order:

1. **Failing test** at the seam that reaches the bug: `src/**/*.test.ts` in `packages/shared` or `mobile`, `frontend/scripts/test-*.mts`, a backend `*.test.ts`. A new backend test file must be added to the explicit list in `backend/package.json`'s `test` script or it never runs.
2. **HTTP script** against a dev backend. `backend/scripts/test-*-flow.mjs` and `three-users.mjs` are the existing pattern; `npm run backend:fixture` gives an isolated server with three seeded accounts (`backend/scripts/three-users.md`).
3. **Fixture replay**: save the real payload (a `library.json`, a request body) to disk and push it through the code path in isolation.
4. **Headless browser**: Playwright is in `frontend`'s dependencies.
5. **Differential**: same input through `main` and the branch, or two configs; diff the outputs. For "worked last week", `git bisect run` the loop.
6. **Device**: for a rendered mobile bug, dispatch `device-checker` with the exact steps and the symptom to watch for. Only when no other seam reaches the bug.
7. **Human in the loop**: last resort. Give the user numbered steps and the one observation to report back.

Then tighten it: faster (narrow the test, skip unrelated setup), sharper (assert on the user's exact symptom, not "didn't crash"), deterministic (pin time, seed randomness, isolate the data dir). For a flaky bug, raise the reproduction rate — loop the trigger 100×, add load, narrow timing windows — until it fails often enough to debug.

**Done when** you can name one command you have already run (show it and its redacted output) that is red-capable on this exact symptom, deterministic, takes seconds, and runs unattended. If you catch yourself building a theory before that command exists, stop: that is the failure this skill prevents.

If no loop is possible, say so, list what you tried, and ask the user for an environment that reproduces it, a captured artifact (log, HAR, screen recording), or permission to add temporary instrumentation. Don't hypothesise without a loop.

## 2. Reproduce and minimise

Run the loop and confirm it shows the failure the **user** described, not a nearby one. Then cut inputs, steps and config one at a time, re-running after each cut. Done when every remaining element is load-bearing.

## 3. Hypothesise

Write 3–5 ranked, falsifiable hypotheses before testing any: "if X is the cause, changing Y makes it disappear". Show the list to the user — they may re-rank it instantly — but keep going if they're away.

## 4. Instrument

One probe per prediction, one variable at a time. Prefer a debugger or REPL; otherwise targeted logs at the boundaries that separate hypotheses, each tagged with a unique prefix like `[DEBUG-a4f2]`. For performance, measure a baseline first, then bisect.

## 5. Fix and regression-test

Turn the minimised repro into a failing test at a seam that exercises the real bug pattern, watch it fail, fix, watch it pass, then re-run the original loop. If no seam can hold the real pattern, say so — that's an architecture finding for `improve-codebase-architecture`, not something to paper over with a shallow test.

## 6. Clean up

- [ ] Original loop is green.
- [ ] Regression test passes, or the missing seam is reported.
- [ ] `rg '\[DEBUG-'` finds nothing.
- [ ] Throwaway scripts deleted.
- [ ] The confirmed hypothesis goes in the commit message.
