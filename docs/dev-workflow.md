# Dev workflow

Port slots, the emulator lease, and how concurrent agent sessions share this repo without stepping on each other. Read this before starting a dev server, taking the emulator, or starting a new agent session.

## Port slots and dev servers

Run `node scripts/dev-emulator.mjs` (claims this worktree's port slot) and `npm run dev:release` when done. Never hardcode 3000/8081/5173, and never kill another worktree's process to free a port.

Run `npm run dev:status` to see which worktrees hold slots, which ports they bound, and who holds an emulator — agents should use `node scripts/dev-status.mjs --json` instead.

`adb root` drops the emulator's reverse tunnels; `npm run dev:tunnels` puts this worktree's back, and `dev:status` warns when they are gone.

The emulator's Metro is closed to the LAN (it reaches it via `adb reverse` on loopback), so it never shows on another device's Expo Go home screen — a physical phone's Metro still needs LAN and still can.

## Emulator leasing

The emulator is leased, two at a time. Take one only to verify a change that must be rendered — layout, navigation, touch behaviour, animation, native modules. Not for backend, shared-package, type or refactor work. Write, typecheck and test with no device, then take the lease for one verification pass at the end.

## Concurrent agents and worktrees

Never edit directly in the primary checkout (`~/Documents/scripta` itself, whatever branch it happens to be on) — treat it as what new worktrees branch off, not a workspace. Two sessions in the same checkout share one git index; a `git add`/`commit` there can silently sweep up the other session's staged files.

Every agent session starts with `EnterWorktree` (or `git worktree add .claude/worktrees/<name> -b <branch> origin/main` where that tool isn't available), then runs `npm run dev:link-deps` once inside it. That command symlinks `node_modules` from the primary checkout instead of paying for a full reinstall, and falls back to a real `npm install` on its own if this branch's `package-lock.json` actually differs.
