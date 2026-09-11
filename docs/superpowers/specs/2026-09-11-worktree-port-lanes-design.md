# Worktree port lanes

Date: 2026-09-11
Status: approved for planning

## Problem

Concurrent worktrees collide on three port numbers, and the collisions are
silent.

`scripts/dev-emulator.mjs:60-61` pins `BACKEND_PORT = 3000` and
`METRO_PORT = 8081` as module constants. Every worktree runs that same
script, so the numbers are identical everywhere and the first process to
bind wins. `frontend/vite.config.ts` never pins a port, so Vite slides
5173 → 5174 → 5175 and no record exists of which worktree holds which.

Three consequences, worst first:

1. **Silent cross-branch reads.** `frontend/src/api/baseUrl.ts:20`
   hardcodes `DEFAULT_API_PORT = 3000`. A worktree whose Vite slid to
   :5174 still sends API calls to :3000 — another branch's backend. The
   page renders correctly while reading the wrong database. There is no
   error and no visual tell.
2. **CORS failures.** `backend/.env.example` pins
   `FRONTEND_URL=http://localhost:5173`, so a worktree on a non-default
   Vite port is rejected unless that value moves with it.
3. **Wrong-branch renders on device.** Expo Go lists every advertising
   Metro and silently reconnects to the wrong one after a reload or
   crash (observed 2026-09-10: seeded fixtures became another account's
   books mid-test).

Existing mitigations are manual and expensive: an `lsof` → `ps` →
`git branch --show-current` ritual before trusting a screen, and a
`POST /auth/login` probe at `scripts/dev-emulator.mjs:230` whose only job
is to answer "is the server on :3000 mine?".

What is already correct: `scripts/devDataDir.mjs` resolves
`backend/data/dev` relative to the script's own location, so every
worktree already has isolated SQLite files and storage directories. This
design does not touch that.

## Non-goals

- **Docker.** Container isolation addresses process and filesystem state,
  which the per-worktree data directories already handle. It cannot help
  with Metro file watching across a bind mount or `adb` device access on
  macOS, so the backend would be containerised while Metro and the
  emulator stayed on the host and the device still needed arbitrating.
  This is a naming problem, not an isolation problem.
- **An always-on main instance.** Considered and rejected: excluding
  Metro from it (to avoid a permanent decoy in Expo Go) leaves a
  permanently-running web app, while the work it would support is
  predominantly native mobile. It would need `npm install` after
  dependency merges, `packages/shared` rebuilds and a maintained seeded
  database — ongoing upkeep for a question rarely asked. Slot 0 stays
  reserved for the primary checkout, booted on demand.
- **Changing any `npm run` script a developer types today.**

## The slot scheme

A worktree claims one integer slot. Every port derives from it:

```
backend  = 3000 + 100 * slot
vite     = 5173 + 100 * slot
metro    = 8081 + 100 * slot
```

Slots are `0..15`. Slot 0 is reserved for the primary checkout (the first
entry of `git worktree list`), so the familiar 3000/5173/8081 keep
meaning "the main checkout" rather than "whoever booted first". One rule
— add 100 per slot — makes the whole scheme computable in your head:
slot 2 is :3200, :5373, :8281.

### Derived values

One slot number decides five things. Any one of them left at a default
reproduces the silent-read bug.

| Value | Written to | Slot 0 | Slot 2 |
|---|---|---|---|
| `PORT` | `backend/.env` | 3000 | 3200 |
| `FRONTEND_URL` | `backend/.env` (CORS) | `http://localhost:5173` | `http://localhost:5373` |
| `VITE_API_PORT` | `frontend/.env.local` | 3000 | 3200 |
| `EXPO_PUBLIC_API_URL` | `mobile/.env.local` | `http://127.0.0.1:3000` | `http://127.0.0.1:3200` |
| `--port` | `expo start` argument | 8081 | 8281 |

`VITE_API_PORT` is new and replaces the hardcoded constant in
`frontend/src/api/baseUrl.ts`:

```ts
const DEFAULT_API_PORT = Number(import.meta.env.VITE_API_PORT ?? 3000);
export const API_URL =
  import.meta.env.VITE_API_URL ??
  `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}`;
```

`EXPO_PUBLIC_API_URL` is written as `127.0.0.1` because the emulator
reaches the backend through `adb reverse`. Booting with `--lan`
substitutes the host's LAN address in that one value, for a physical
phone with no cable. The two must never be mixed: `127.0.0.1` on an
untethered phone means the phone itself, which has silently broken device
testing here before.

The host derivation in `baseUrl.ts` is deliberately preserved. It is what lets a phone
open `http://<lan-ip>:5373` and reach `http://<lan-ip>:3200` with no
per-machine `.env` editing. Writing an absolute `VITE_API_URL` instead
would hardcode `localhost` and break phone testing.

### Failing loudly

`frontend/vite.config.ts` gains `server.strictPort = true`. Sliding to
the next free port is the mechanism that produced consequence 1; a
worktree whose assigned port is taken must refuse to start and say so.
The backend already fails on `EADDRINUSE`.

## The registry

One file per clone, shared by every worktree of it:

```
$(git rev-parse --path-format=absolute --git-common-dir)/scripta-dev.json
```

Verified: this resolves to `/Users/andreribeiro/Documents/scripta/.git`
from the primary checkout and from `scripta-wt/5a` alike. Living inside
`.git` means it is shared by construction, never version-controlled, and
disappears with the clone. `--path-format=absolute` is required — the
bare form returns a relative `.git` in the primary checkout. Needs git
≥ 2.31; the machine has 2.55.0.

### Shape

```json
{
  "version": 1,
  "slots": {
    "0": { "worktree": "/Users/andreribeiro/Documents/scripta",
           "branch": "main", "pid": 40122, "claimedAt": "2026-09-11T14:02:11Z" },
    "2": { "worktree": "/Users/andreribeiro/Documents/scripta-wt/4d",
           "branch": "mobile/4d-design-system", "pid": 51880,
           "claimedAt": "2026-09-11T14:20:03Z" }
  },
  "devices": {
    "scripta-dev-0": { "worktree": "…/scripta-wt/5a", "pid": 51993,
                       "takenAt": "2026-09-11T14:31:40Z" },
    "scripta-dev-1": null
  }
}
```

Writes take an exclusive lock (`O_EXCL` lockfile beside it, stale after
10s) so two worktrees booting at once cannot claim the same slot.

### Claim

1. Read the registry. If this worktree already holds a slot, reuse it.
2. The primary checkout takes slot 0. Others take the lowest free slot.
3. Verify all three derived ports are actually free before writing the
   claim; if any is held by something outside the registry, skip to the
   next slot and warn.
4. Write the five derived values, then start the stack.

### Release

On teardown: kill this worktree's processes, remove the slot entry,
release any held device. A slot whose `pid` is gone is stale and may be
reclaimed by the next worktree that wants it — this is what keeps the
registry honest when an agent crashes rather than exits.

Ports are cheap; running stacks are not. A booted worktree is roughly
400–700 MB across backend, Vite and Metro, so the registry exists as much
to enable teardown as to prevent collisions.

## Device lease

Two AVDs, `scripta-dev-0` and `scripta-dev-1`, making the lease a
two-slot semaphore rather than a mutex. The machine is an M1 Pro with
32 GB and 10 cores; the existing AVD is configured `hw.ramSize=2G`,
`hw.cpu.ncore=4`. RAM is not the constraint — CPU is, since two AVDs at
4 cores each claim 8 of 10 while Metro bundles. The second AVD is
configured with `hw.cpu.ncore=2`.

A worktree takes a named device, `adb reverse`s its own backend and Metro
ports to it, and releases when done. Taking a device that is already held
waits or fails with the holding worktree named — never silently steals
the tunnels.

Handoff runs `pm clear host.exp.exponent`, because Expo Go restores the
previous session's route and signed-in state.

### When to take a device

Take it when the change can only be verified by rendering:

- layout, spacing and typography on a real screen
- navigation, modals, sheets, headers
- touch behaviour — nested `Pressable`, gestures, scroll, keyboard
- Reanimated work
- native modules (image picker, secure store, haptics)

Do not take it for backend work, `packages/shared` logic, type changes,
pure refactors with no render change, or anything a unit test proves.

**Hold it for verification, not development.** Write, typecheck and test
with no device; take the lease once for a single verification pass at the
end. An edit-reload loop that holds a device for an hour is what makes
two devices feel like none.

This is not optional for the cases listed above. A device pass found six
defects that typecheck, 21/21 tests, expo-doctor and a clean
`expo export` all passed — including a menu that never opened on Android
because a nested `Pressable` won the responder race. Static checks cannot
see that class of bug.

## Resource thresholds

Claiming refuses, with a message naming what is already running, when:

- 4 stacks are already booted, or
- free system memory is under 4 GB, or
- a second emulator is requested while 1-minute load average exceeds 8.

These are gates at boot only. Continuous measurement and reporting belong
to the observability tool, which reads this same registry.

## What gets deleted

- `BACKEND_PORT` / `METRO_PORT` constants (`scripts/dev-emulator.mjs:60-61`)
- the `POST /auth/login` "is this my server?" probe
  (`scripts/dev-emulator.mjs:215-240`)
- the hardcoded `DEFAULT_API_PORT` fallback
  (`frontend/src/api/baseUrl.ts:20`)
- the manual `lsof` → `ps` → `git branch` ritual, and the parts of
  `docs`/memory that teach it

## Testing

Unit, against a temp registry file:

- lowest-free-slot allocation, including gaps left by released slots
- primary checkout always resolves to slot 0
- a slot whose `pid` is dead is reclaimable; a live one is not
- concurrent claims under the lock never produce a duplicate slot
- port derivation for slots 0 and 15
- device take/release, including take-while-held

Integration:

- two worktrees boot in sequence and get non-overlapping port sets
- a worktree whose assigned Vite port is externally occupied refuses to
  start rather than sliding
- `dev-emulator.mjs` end-to-end in a non-zero slot reaches the seeded dev
  account

## Rollout

The scheme is inert until a worktree claims, so it can land before every
call site uses it. Order: registry module and tests; `baseUrl.ts` plus
`strictPort`; `dev-emulator.mjs` reading its ports from the claim;
threshold gates; deletion of the superseded probe and constants.

## Follow-on

The observability tool is a separate spec. Its interface to this one is
the registry file: worktree, branch, slot, ports, pid, device holder. Any
field it needs that is not listed above is an amendment here, not a new
source of truth.
