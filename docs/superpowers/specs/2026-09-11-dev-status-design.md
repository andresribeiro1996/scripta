# Dev status

Date: 2026-09-11
Status: implemented — see `docs/superpowers/plans/2026-09-14-dev-status.md`
Depends on: `2026-09-11-worktree-port-lanes-design.md`

Three details below were superseded during implementation: `stale` means
a dead recorded pid AND no listener on any of the slot's three ports, not
a dead pid alone — `dev-emulator.mjs` spawns the backend and Metro
detached and exits, so the claiming pid is normally gone within seconds
while a healthy stack keeps running. Device serials are read from the
lease rather than re-derived via `adb`. The headroom line is defined as
free memory minus the 4 GB floor, printed as GB above or below it.

## Problem

With a dozen worktrees and two emulators, three questions come up
constantly and none of them has an answer short of manual archaeology:

1. **What is running right now?** Which worktrees have stacks up, on
   which branches, owned by which agent session, costing how much CPU and
   memory. Today this is `lsof` → `ps` → `git branch --show-current`,
   repeated per port.
2. **How do I open this branch on my phone?** The URL exists but is
   derivable only by knowing the worktree's slot and the host's LAN
   address, neither of which is written down anywhere a phone can read.
3. **Am I about to cook the laptop?** Boot-time gates in the port-lane
   spec refuse a new stack past a threshold, but nothing shows the
   approach to that line while eight things are already running.

The port-lane registry answers (1) and (2) structurally — it knows every
worktree, slot, branch, session and device holder. What is missing is a
surface that reads it, joins it to live process cost, and renders it for
the two audiences that need it: a terminal, and a phone.

## Scope

Two surfaces over one implementation:

- **`npm run dev:status`** — a printed snapshot. The primary surface.
- **A status page** on a fixed LAN port — the same data, tappable from a
  phone. Built second, as a thin renderer over the same function.

Built in that order deliberately. All the data plumbing lives in the CLI;
the page is a rendering of it, so the two cannot drift. If the page turns
out not to earn its keep, stopping after the CLI loses nothing.

## Non-goals

- **A resident dashboard with continuous polling.** Sampling happens when
  something asks. The page samples per request.
- **Historical data.** No time series, no storage. A snapshot answers all
  three questions.
- **Enforcement.** Thresholds are enforced at boot by the port-lane spec.
  This tool reports; it never blocks or kills.
- **A QR-code dependency.** The repo's rule is to reuse before adding.
  The CLI prints URLs; the page makes them tappable. Reaching the page
  the first time means typing its LAN address on the phone once, then
  bookmarking it.

## Data model

One function, `collectStatus()`, returns everything both surfaces render.

```
{
  host:    { lanAddress, totalMemGB, freeMemGB, loadAvg1, cores },
  stacks:  [ { slot, worktree, branch, session, claimedAt,
               ports: { backend, vite, metro },
               processes: [ { pid, role, rss, cpu, alive } ],
               rssTotalMB, cpuTotal,
               urls: { webLocal, webLan, expoLan } } ],
  devices: [ { avd, serial, holder, takenAt, rssMB } ],
  warnings: [ … ]
}
```

### Sources

| Field | Source |
|---|---|
| slot, worktree, branch, session, ports, device holders | the registry, `$(git rev-parse --path-format=absolute --git-common-dir)/scripta-dev.json` |
| per-process RSS and CPU | `ps -A -o pid,ppid,rss,pcpu,comm` |
| host memory, load, cores | `os.totalmem()`, `os.freemem()`, `os.loadavg()`, `os.cpus()` |
| LAN address | `pickLanAddress()` from `scripts/lanAddress.mjs` — already exists, reused as-is |
| emulator serials | `adb devices` |
| serial → AVD name | `adb -s <serial> emu avd name` |

### Two traps that must be handled

**`ps` is locale-sensitive.** Verified on this machine: `ps -o pcpu`
prints `0,0` under the user's locale and `0.0` under `LC_ALL=C`. A naive
`parseFloat` reads every stack as 0% busy and the tool looks like it
works. Every `ps` invocation sets `LC_ALL=C`.

**A stack is a process tree, not a process.** The registry records one
pid per slot, but Metro spawns bundler workers and `tsx watch` spawns the
server it supervises; the recorded pid's own RSS is a small fraction of
the true cost. Read the full `ps` table once, build a ppid → children
index, and sum each recorded pid's whole subtree. Roles are inferred from
`comm` plus the matching port: `backend`, `vite`, `metro`, `other`.

## CLI

`npm run dev:status`, implemented as `scripts/dev-status.mjs`.

```
scripta dev · 192.168.1.24 · 31.9 GB total, 8.2 GB free · load 3.4 / 10 cores

 SLOT  BRANCH                     SESSION              API   WEB   METRO   RSS     CPU
 0     main                       —                   3000  5173    8081   612 MB   4%
 2     mobile/4d-design-system    4d-design-system    3200  5373    8281   704 MB  22%
 5     mobile/5a-library          5a-library          3500  5673    8581   688 MB  11%

 DEVICE          SERIAL          HELD BY              SINCE
 scripta-dev-0   emulator-5554   mobile/5a-library    14:31  (18m)
 scripta-dev-1   —               free

 3 of 4 stacks · 2.0 GB of 4 GB headroom remaining
```

Flags:

- `--json` — the raw `collectStatus()` object, for agents and scripts.
- `--worktree [path]` — only this worktree (default: cwd), and print its
  connection URLs in full:

```
 mobile/4d-design-system · slot 2

   web,  this laptop   http://localhost:5373
   web,  phone         http://192.168.1.24:5373
   app,  phone         exp://192.168.1.24:8281
   app,  emulator      exp://127.0.0.1:8281   (needs adb reverse tcp:8281)
```

A slot whose recorded pid is dead prints as `stale` rather than
disappearing, so a crashed agent's abandoned slot is visible rather than
merely absent.

### Warnings

Printed under the table, never as an exception:

- free memory below the port-lane boot threshold
- load average above the two-emulator threshold
- a stale slot (dead pid, entry still held)
- a device held longer than 30 minutes — a likely forgotten lease
- a port in the registry that nothing is listening on, or listening with
  the wrong worktree's process

The last one is the counterpart to the bug the port-lane scheme exists to
prevent, kept as a check rather than assumed away.

## Status page

`scripts/dev-status-server.mjs`, bound to `0.0.0.0:7070` — outside every
slot range (backend 3000–4500, Vite 5173–6673, Metro 8081–9581).

A single self-contained HTML page, no build step and no dependencies,
served fresh per request from `collectStatus()`. One card per stack:
branch, session, slot, memory and CPU, and three tappable links —
`http://<lan>:<vite>`, `exp://<lan>:<metro>`, and a copy button for the
API base. Device rows show holder and duration. A host bar carries free
memory, load and stack count.

`npm run dev:status -- --serve` runs this script rather than the printed
snapshot. Started and stopped by hand; it is not part of any worktree's
stack and holds no slot.

**One caveat, stated rather than designed around.** Tapping `exp://` from
the phone opens the right project, but Expo Go still lists every
advertising Metro on its home screen and can reconnect to a different one
after a reload or crash. The page removes the guessing at connect time;
it cannot remove that. The standing check applies — confirm the branch by
something only it renders before trusting what is on screen.

## Testing

Unit, against fixture `ps` output and a temp registry:

- `LC_ALL=C` parsing, and that comma-decimal input is rejected loudly
  rather than silently read as zero
- subtree summation: a recorded pid with three descendants reports their
  combined RSS
- role inference from `comm` and port
- dead pid renders `stale`, live pid does not
- URL construction for slots 0 and 15, local and LAN
- warning triggers at each threshold boundary

Integration:

- with two stacks booted, `--json` lists both with non-overlapping ports
  and plausible non-zero RSS
- `--worktree` from inside a worktree resolves that worktree's own slot
- the page serves and renders with zero stacks running

## Rollout

1. `collectStatus()` plus its `ps` and registry readers, with tests.
2. The CLI renderer, `--json` and `--worktree`.
3. Warnings.
4. The page, reusing (1) unchanged.

Steps 1–3 are independently useful; step 4 is optional and deferred until
the CLI has been lived with.
