# Three-user fixture

`npm run backend` (the normal dev command) no longer loads this fixture — it runs the real `backend/src/server.ts` against your own `backend/data/*.sqlite`. To run this fixture's own isolated, self-contained server instead, from the repository root:

```sh
npm run backend:fixture
```

which is `npm run dev:fixture --workspace backend`. Production `npm start` remains unchanged.

This seeds and starts the real API on port 3000 using only `backend/data/three-users/`. No `.env` is required. All database and upload paths are isolated; OAuth and social integrations are disabled. Existing development data is untouched. Open the web app as usual (`npm run frontend`) or point Expo at this API.

## `--shared` mode

For testing `fixture_alice`/`fixture_bob`/`fixture_charlie` alongside the dev account seeded by `scripts/dev-account.mjs` (see the root `mobile/README.md`'s "Testing on an emulator"), pass `--shared`:

```sh
node --import tsx scripts/three-users.mjs --seed-only --shared
```

run from `backend/`, with `AUTH_DB_PATH` etc. already pointed at `backend/data/dev/` (see `scripts/devDataDir.mjs`) — `scripts/dev-emulator.mjs` does this for you as one of its own seeding steps. In `--shared` mode this script seeds into whatever `*_DB_PATH`/`*_STORAGE_PATH` the ambient environment already points at instead of `backend/data/three-users/`: it skips generating `secrets.json`, skips blanking OAuth/socials/Hardcover env vars, and skips `ALLOW_LAN_ORIGINS` — all of that is the caller's job. The "existing development data is untouched" guarantee above still holds in `--shared` mode, but for a different reason: seeding goes to the dedicated `backend/data/dev/` directory, never to your own `backend/data/*.sqlite`. `--shared` always implies seed-only (it never calls `app.listen()` — the real backend, started separately, serves this data) and refuses `--reset` (reset the whole `backend/data/dev/` directory instead, e.g. `node scripts/dev-emulator.mjs --reset`). The manifest and lock live alongside the ambient databases, not in `backend/data/three-users/`.

The isolated default mode and `--check` described below are unaffected by `--shared` and keep behaving exactly as they always have.

| Login | Starting state |
|---|---|
| `fixture_alice` | 12 books, shared library, shared/private freeform murals, two private source tier lists plus two open community copies, active four-book Arena |
| `fixture_bob` | 8 books (4 overlap Alice), a ballot on each poll, one Arena vote under a separate voter token |
| `fixture_charlie` | Saved empty library, no murals, polls, or votes |

Password for all three: `scripta123`. Emails are `<login>@example.test`. All books and annotations are synthetic; covers use the app's fallback. Each poll starts with Alice's initial ranking and Bob's different ranking (two ballots). Charlie and logged-out visitors are ready for first participation. Arena round one lasts seven days; reset if it expires, or settle early as Alice.

The command prints web links. IDs, share tokens, vote codes, and Bob's ballot IDs are also in `backend/data/three-users/fixture.json`; session tokens are not saved there. These are initial links: manually revoked shares and deleted content stay revoked/deleted on restart.

```sh
npm run fixture --workspace backend -- --seed-only
npm run fixture --workspace backend -- --reset
npm run test:fixture --workspace backend
```

Normal reruns preserve testing progress and keep the three fixture passwords set to `scripta123`, including accounts created with the previous password. `--reset` removes and recreates the entire isolated fixture environment, including anything you manually created in it; it never touches the usual databases. Stop the fixture server first. An interrupted initial seed requires `--reset`. A lock prevents concurrent runs/reset; after a hard crash, remove `backend/data/three-users.lock` only once its process has stopped. Tests use a disposable temporary directory and leave your fixture progress alone.

For phone testing, use your Mac's LAN IP in both terminals:

```sh
npm run dev:mobile --workspace backend
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000 npm run mobile
```

Replace the example IP. `FRONTEND_URL` controls generated web share links; serve Vite with `npm run dev:mobile --workspace frontend` if opening those links on the phone. Expo receives the same public route paths through its existing routing. `PORT` can change the API port; update the client URL and `PUBLIC_API_URL` to match. Use this fixture only on your development machine/trusted LAN: the credentials are deliberately public.

## Independent sessions

Use three browser profiles or separate devices, plus a logged-out session. Multiple tabs in one profile share login and voter storage. Sign out of your usual account before using the fixture backend; reset creates new accounts and requires signing in again.

Arena votes belong to a device/browser token, not the signed-in account. To see Bob's seeded vote in his web profile, run this in the browser console on the app origin, then reload:

```js
localStorage.setItem("bookarena.voterToken", "scripta-fixture-bob");
```

For native development, the equivalent existing AsyncStorage key is `arena-voter-token`. Without setting it, a fresh installation represents a new Arena voter even when logged in as Bob. You can instead cast Bob's first device vote manually; the synthetic seeded vote still contributes to the total. Charlie should use a separate device/profile token.

Tier-list ballots belong to the signed-in account, but native ballot restoration currently also requires a locally saved ballot ID. On a fresh native installation, Bob's seeded ballot may initially appear as an unsubmitted board; submitting a ranking updates his existing ballot rather than adding another. To begin directly in the existing-ballot view during native debugging, set AsyncStorage `tierlist-ballot:<code>` to that poll's `bobBallotId` from `fixture.json`. Do not copy Bob's storage into Charlie's session. This fixture does not change the app's session/ballot-restoration behavior.

## Manual checks

- As Bob/Charlie/logged out, open Alice's library and shared mural. Book metadata renders; the unreferenced `PRIVATE_FIXTURE_NOTE` annotation does not. The private mural is owner-only. Explicitly adding a quote block is an intentional share of that quote and its annotation.
- As Alice, revoke each share. Previously copied links stop working. Reset restores new links.
- As Bob, inspect/edit his poll ballot. Total remains two. As Charlie, submit his first ballot; total becomes three. Compare results, then close voting as Alice and verify further submissions fail.
- Logged out, anonymous voting succeeds and members-only voting requests login. Participants cannot edit/delete Alice's source content or use Arena owner controls.
- As Bob's Arena voter, the first duel is already voted and rejects a second vote. Charlie can vote independently. Alice can settle the unvoted second duel to exercise a tie and resolve it.
- Switch Alice → Charlie on the same client. Charlie's empty library and own content replace Alice's; private data must not persist in caches. Repeat after a cold start. Check the saved-ballot behavior separately from account ownership.

The automated fixture check covers API data, overlap, privacy, ownership, ballot updates/counts, closed polls, duplicate Arena votes, revocation, and rerun preservation. Device layout, cache isolation, and native storage behavior need the manual checks above.
