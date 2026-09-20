# Dev workflow

Port slots, the emulator lease, and how concurrent agent sessions share this repo without stepping on each other. Read this before starting a dev server, taking the emulator, or starting a new agent session.

## Port slots and dev servers

Run `node scripts/dev-emulator.mjs` (claims this worktree's port slot) and `npm run dev:release` when done. Never hardcode 3000/8081/5173, and never kill another worktree's process to free a port.

Run `npm run dev:status` to see which worktrees hold slots, which ports they bound, and who holds an emulator — agents should use `node scripts/dev-status.mjs --json` instead.

`adb root` drops the emulator's reverse tunnels; `npm run dev:tunnels` puts this worktree's back, and `dev:status` warns when they are gone.

The emulator's Metro is closed to the LAN (it reaches it via `adb reverse` on loopback), so it never shows on another device's Expo Go home screen — a physical phone's Metro still needs LAN and still can.

## Driving the app

Wait for the app to reach a state instead of sleeping for a guessed number of seconds:

```
npm run dev:wait -- "Sign in"            # exits 0 once that text is on screen
npm run dev:wait -- "Loading" --absent   # ...or once it is gone
npm run dev:wait -- "Sign in" --timeout 120
```

It polls `uiautomator dump` on the emulator this worktree leases, prints how long it took, and on a timeout prints the screen it gave up on — which is usually the whole diagnosis (a splash means still bundling, the wrong route means the app went somewhere else). Chain it: `npm run dev:wait -- "Sign in" && adb -s <serial> exec-out screencap -p > screen.png`.

Any route can be opened directly, which saves signing out to reach an auth screen:

```
adb -s <serial> shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:<metro-port>/--/login" host.exp.exponent
```

**If the app seems to ignore an edit, believe it.** Expo Go can run code from a different branch entirely, with nothing on screen saying so — `@expo/metro-config` puts Metro's bundler cache in one machine-wide directory (`os.tmpdir()/metro-cache`), so concurrent worktrees shared it, and the `transform.bytecode=1` bundle that Expo Go always requests came back with another checkout's compiled modules. Measured 2026-09-20: it survived `pm clear`, cold starts, a Metro restart and an emulator reboot. `dev-emulator.mjs` and `dev-phone.mjs` now give each worktree its own cache (`scripts/devMetroCache.mjs`), so this should not recur — but if it ever does, confirm it before theorising by putting a marker in the screen under test and asking for it:

```
npm run dev:wait -- "MARKER-1" --timeout 30
```

No marker means you are looking at stale code. `cd mobile && npx expo start --clear` is the escape hatch.

## Emulator leasing

The emulator is leased, two at a time. Take one only to verify a change that must be rendered — layout, navigation, touch behaviour, animation, native modules. Not for backend, shared-package, type or refactor work. Write, typecheck and test with no device, then take the lease for one verification pass at the end.

## Concurrent agents and worktrees

Never edit directly in the primary checkout (`~/Documents/scripta` itself, whatever branch it happens to be on) — treat it as what new worktrees branch off, not a workspace. Two sessions in the same checkout share one git index; a `git add`/`commit` there can silently sweep up the other session's staged files.

Every agent session starts with `EnterWorktree` (or `git worktree add .claude/worktrees/<name> -b <branch> origin/main` where that tool isn't available), then runs `npm run dev:link-deps` once inside it. That command symlinks `node_modules` from the primary checkout instead of paying for a full reinstall, and falls back to a real `npm install` on its own if this branch's `package-lock.json` actually differs.
