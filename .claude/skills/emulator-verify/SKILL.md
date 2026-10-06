---
name: emulator-verify
description: Verify a rendered mobile change on the leased Android emulator — lease check, signed-in fixture stack, driving Expo Go with adb, screenshots, and release. Use for layout, navigation, touch, animation or native-module changes in mobile/, never for backend, shared-package, type or refactor work.
---

# Emulator verify

One verification pass at the end of mobile work, after typecheck and tests are green. Background and the reasons behind each rule: `docs/dev-workflow.md`.

## 1. Check the lease — once

```bash
node scripts/dev-status.mjs --json
```

Read `devices[]`:

- A device with `holder: null` is free. An emulator listed in `orphans` (running, no holder) is adopted by `dev-emulator.mjs` — it is not "a second emulator", so the load-average warning does not block you when no AVD has a holder.
- Every device held by another worktree:
  - Optional check (a screenshot, visual confirmation) → stop now. Report "emulator occupied", finish the checks that need no device. Do not poll, retry, take the held lease, boot another emulator, or reseed data.
  - Required acceptance → say you are waiting before you wait.

## 2. Start the stack

```bash
node scripts/dev-emulator.mjs
```

Idempotent: claims this worktree's port slot, leases an AVD, seeds the signed-in dev account (`scripta-dev@local.test`, 24-book fixture, three fixture users), starts backend and Metro, opens Expo Go. Add `--reset` only when the pass needs clean fixture data. Never ask the user to sign in.

Get the serial and ports for this worktree from `node scripts/dev-status.mjs --json`: the `devices[]` entry whose `worktree` is this worktree, and the `stacks[]` entry for its `ports.metro`. Never hardcode `emulator-5554`, 3000 or 8081.

## 3. Drive the app

Wait for a state; never sleep a guessed number of seconds:

```bash
npm run dev:wait -- "My shelf" --timeout 120
```

On timeout it prints the screen it gave up on — read that first (a splash means still bundling, a wrong route means the app went elsewhere).

Open any route directly:

```bash
adb -s <serial> shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:<metro-port>/--/<route>" host.exp.exponent
```

Screenshot and structure. `<shots-dir>` is the directory the caller named, or `mktemp -d` if none; name each file for the screen and state it shows:

```bash
adb -s <serial> exec-out screencap -p > "<shots-dir>/<route>-<what>.png"
adb -s <serial> shell uiautomator dump /sdcard/ui.xml && adb -s <serial> shell cat /sdcard/ui.xml
```

Tap with `adb -s <serial> shell input tap <x> <y>` using `bounds` from the dump. Type with `input text` (`%s` for spaces).

Rules that each cost a session once:

- **Read labels from the screenshot, not uiautomator.** uiautomator reports the full string even when Android draws it clipped. Open the PNG with Read and zoom into every label you check.
- **Move Expo Go's dev FAB first** when anything near the top-right header matters: drag it from its centre to the left edge at mid-height, clear of the tab bar and header. It steals taps beyond its reported bounds, and a stolen tap into a text field looks focused but ignores input.
- **Swipes:** use `input motionevent DOWN/MOVE/UP` in one `adb shell "…"` call, not `input swipe`. Move ~2px per step for the first ~24px, then larger steps, and travel past half the page. Run a control drag on an area with no nested scroller first.
- A persistent LogBox toast can swallow taps on the bottom bar. If it names `.value` inside an inline style, that is the worklets dev warning — report it, don't chase it.
- `adb root` drops the reverse tunnels; run `npm run dev:tunnels` after it.

## 4. Change state only through the app

Edit the dev account only through the app's UI (or its HTTP API the way the app calls it). Never write to `backend/data/`, any `.sqlite` file, or the fixture files. Put every test change back through the UI (Undo, delete what you added) and report anything you couldn't.

## 5. Suspect the harness before the app

If the change seems absent or a control seems broken, check in order before reporting an app bug:

1. Did the input reach the app? (FAB, toast, keyboard covering the target.)
2. Is this bundle your code? Put a marker string in the screen under test and run `npm run dev:wait -- "MARKER-1" --timeout 30`. No marker → stale bundle; `cd mobile && npx expo start --clear`.
3. Is the device on this worktree's Metro and backend? (`missingTunnels` in dev-status, the deep-link port.)
4. Does a cold restart (`adb -s <serial> shell am force-stop host.exp.exponent`, then the deep link) clear it? Fast Refresh throws hook-order errors a restart doesn't.

## 6. Release and report

```bash
npm run dev:release
```

Always release, including after a failure. Report: each check with pass/fail, the screenshot path behind it, state you could not restore, and anything you attributed to the harness rather than the app.
