# Beta tester agent

Date: 2026-10-04
Status: design agreed, awaiting spec review

## Problem

Scripta has typecheck, lint and unit tests, and `device-checker` confirms a
named mobile change on the emulator. Nothing uses the app the way a reader
does: walking every screen, trying the edges, and noticing what is broken,
confusing or off-system. UX problems are found only when the user trips over
them on their own phone.

## Decisions

- **Job: exploratory sweep.** Not branch acceptance, scripted journeys or
  personas. The agent roams the app and reports what it finds.
- **Surface: mobile only**, on the leased Android emulator, reusing the
  `emulator-verify` harness. Web is out of scope (it has no seeded-stack
  script without the emulator; see Out of scope).
- **Scope: the whole app per run**, broad first, every route visited.
- **Output: a ranked markdown report plus screenshots**, in a gitignored
  folder, sent to the user and triaged by the main session. Not GitHub issues
  (dedupe work, no image upload from `gh`), not an artifact page (design work
  every run), not chat-only (loses the screenshots).
- **Approach B: a Sonnet agent plus one snapshot helper.** The helper turns
  each step into a cheap text listing so the agent opens images only to judge
  visuals; that is what fits a whole-app run in one agent's context. Approach
  C (Sonnet driver, Opus judge) is the fallback if B's findings are shallow.

## Files

| File | Change |
|---|---|
| `scripts/devSnapshot.mjs` | New. Pure functions: parse uiautomator XML nodes, px→dp, format the listing. |
| `scripts/devSnapshot.test.mjs` | New. Unit tests against a captured XML fixture. |
| `scripts/fixtures/uiautomator-sample.xml` | New. One real dump from the emulator, used by the tests. |
| `scripts/dev-snapshot.mjs` | New. CLI: lease lookup, adb calls, file writes, prints the listing. |
| `package.json` | Add `"dev:snapshot": "node scripts/dev-snapshot.mjs"`. |
| `.claude/agents/beta-tester.md` | New agent. |
| `.gitignore` | Add `/beta-tests/`. |
| `CLAUDE.md` | Add a dispatch-table row for `beta-tester`. |

## Snapshot helper

```
npm run dev:snapshot -- <name> --out <dir>
```

1. Finds this worktree's lease the way `dev-wait.mjs` does
   (`worktreeIdentity` + `deviceHolders`). No lease → exit 1 with
   "`<branch>` holds no emulator — run `node scripts/dev-emulator.mjs` first."
2. `adb exec-out screencap -p` → `<dir>/<name>.png`, then
   `sips -Z 1200 <file>` to shrink it in place (about 540×1200, under ~1k
   tokens per Read).
3. `uiautomator dump` via the existing `readScreenText` in `devWait.mjs`.
4. `adb shell wm density` → dp = px × 160 / density. Read on every call; it is
   one cheap shell call and survives an AVD swap.
5. Prints the listing to stdout, one line per node that has text,
   `content-desc` or `clickable="true"`, in tree order:

```
07-murals-list · 411×914dp · saved <dir>/07-murals-list.png
  tap 540,206   "New mural"             363×52dp
  tap  44,132   desc="Back"              36×36dp  ⚠ <44dp
  tap 540,1180  "Summer reads"          379×96dp
       ·        "Murals"
```

- `tap x,y` is the node's centre in device pixels, ready for `input tap`.
  Non-clickable nodes print `·` instead.
- `⚠ <44dp` marks a clickable node whose width or height is under 44dp
  (DESIGN.md's touch-target floor). It is a candidate only: uiautomator bounds
  exclude `hitSlop`.
- Entities are decoded the same way `parseScreenText` decodes them; reuse or
  extend that function rather than writing a second decoder.

Errors: `readScreenText` already returns `""` on a failed dump. The helper
retries the dump once; if it is still empty it keeps the screenshot, prints
"dump failed — screenshot only" and exits 0, so the agent knows it has an
image but no listing. A failed `screencap` or `sips` exits 1 with adb's
message; nothing is caught that the caller cannot act on.

## The agent

`.claude/agents/beta-tester.md`, `model: sonnet`, `tools: Bash, Read, Write`.
Write is for the report only.

**Inputs from the dispatcher:** the worktree path and an output directory.
Default output: `beta-tests/<YYYY-MM-DD-HHMM>/` in the **main checkout**
(`$(git rev-parse --git-common-dir)/..`), so a report survives worktree
cleanup.

**Procedure**

1. Read `.claude/skills/emulator-verify/SKILL.md` and follow it for the lease
   check, stack start, adb driving rules and release. If every device is
   held, stop and report "emulator occupied"; a sweep is optional work.
2. `node scripts/dev-emulator.mjs --reset`, so every sweep starts from the
   same 24-book fixture plus the three fixture users.
3. `adb logcat -c`.
4. Read `DESIGN.md` once. Read a feature spec under `docs/superpowers/specs/`
   only when a behaviour looks wrong, to check whether it is intended.
5. Build the coverage list by listing `mobile/src/app/` (expo-router files,
   skipping `_layout` and the `dashboard/*` redirects). The list is derived
   each run, so it never goes stale.
6. Sweep, in this order:
   1. **First run.** Sign out, sign up `beta-<unix-time>@local.test` on the
      local backend, go through choose-username and welcome-avatar, then the
      empty library, shelf, murals and games.
   2. **Dev account.** Sign out, then cold restart
      (`am force-stop host.exp.exponent` + deep link); dev auto-login
      restores `scripta-dev@local.test`. Then each of the five tabs and the
      stack routes they reach.
   3. **Public routes by deep link:** share links the sweep created,
      `vote/<code>`, `play/<code>`, `arena/<id>`.
7. On each screen: `dev:snapshot`; Read the PNG on first visit or after a
   visual change; use every control once; try the edges: empty and very long
   input, emoji, double-tap, back mid-action, landscape rotation, destructive
   actions with their confirm and undo. Append each finding to `report.md`
   as soon as it is confirmed, and mark the route in the coverage table.
8. `adb logcat -d ReactNativeJS:E '*:S'` for JavaScript errors raised during
   the run.
9. Finish the report (summary, JavaScript errors, leftover state), then
   `npm run dev:release`, whatever happened.

**Test data.** The sweep mutates freely (creates murals, deletes books, makes
share links). It does not reset at the end, since that means rebooting the
stack. The report says the fixture is dirty, and the next pass that needs
clean data runs `--reset`. Each worktree has its own `backend/data/dev/`, so
no other worktree is affected. The sweep never writes `backend/data/`, a
`.sqlite` file or fixtures directly; `--reset` is the only wipe.

**Evidence rules**

- A bug is reproduced a second time before it is reported. A visual or copy
  finding needs one clear screenshot.
- Run emulator-verify's "suspect the harness first" checks before blaming the
  app.
- Every label quoted in a finding is checked against the zoomed PNG, not
  uiautomator text.
- A `⚠ <44dp` candidate is reported only after `rg` finds no `hitSlop` on the
  component that renders it.

**Never:** edit source, commit, push, or fix what it finds.

## Report

`<out>/report.md`, next to the screenshots:

1. **Summary**: finding counts by severity; the three to fix first.
2. **Findings**, ranked by severity, then by how central the screen is. Each:
   - severity: blocker / major / minor / polish
   - category: bug / UX friction / design-system breach / accessibility / copy
   - screen and route
   - numbered steps to reproduce
   - expected vs actual, citing the DESIGN.md rule or spec line when one applies
   - screenshot filename
3. **JavaScript errors** from logcat, deduplicated, with counts.
4. **Coverage table**: every route from step 5, marked visited / partial / not
   reached, with the reason for anything not visited.
5. **Harness notes and leftover state**: anything blamed on the harness and
   how it was confirmed; the throwaway account; the dirty fixture.

The agent's reply to the dispatcher is the report path plus the summary
section, nothing more.

## Main-session integration

New row in CLAUDE.md's dispatch table:

| When | Agent |
|---|---|
| User asks for a beta test or UX sweep of the app | `beta-tester`; send `report.md` with SendUserFile, then triage it with the user |

Triage is the main session's job: confirmed findings become ordinary plan
tasks through the existing implementer flow. The tester never fixes anything.

## Testing

- `scripts/devSnapshot.test.mjs` (runs under `npm run test:scripts`): node
  parsing from the captured fixture, px→dp at density 420, the `<44dp` flag
  at the boundary (43.9 flagged, 44 not), entity decoding, non-clickable nodes
  printed with `·`, nodes with neither text nor desc nor clickable skipped.
- The CLI wrapper stays thin like `dev-wait.mjs` and is exercised by hand once
  on the emulator.
- Acceptance: one real whole-app sweep, reviewed with the user. Shallow or
  wrong findings mean tuning the agent prompt, or moving to approach C.

## Verify during implementation

- That `console.error` from the app reaches `logcat` under `ReactNativeJS`
  in Expo Go. If not, read `metro.log` in `$TMPDIR/scripta-dev-emulator/`
  from a byte offset taken at step 3 instead.
- That sign-out followed by a cold restart lands on the dev account (auto-login
  only runs in `loadSession`, when no refresh token survives).

## Risks

- **Cost.** Device passes already ran up to 7.9M weighted tokens each (agent
  circuit breaker spec, 2026-10-04). A whole-app sweep is several of those in
  one run. The downscaled PNG plus text listing is the mitigation; if the
  first run is still too expensive, split it into areas run one after another.
- **Context.** One agent holds the whole sweep. If it compacts mid-run, the
  coverage table and findings written so far must survive: the agent appends
  each finding to `report.md` as it confirms it, rather than writing the
  report only at the end.

## Out of scope

- Web. It needs a script that starts a seeded backend plus Vite without an
  emulator lease, which does not exist yet.
- Google OAuth and anything that needs a second physical device.
- Automatic contrast checks, pixel diffs, LogBox detection (LogBox text shows
  up in the listing anyway).
- Comparing against previous reports. Each run stands alone.
- Running in CI or on a schedule.
