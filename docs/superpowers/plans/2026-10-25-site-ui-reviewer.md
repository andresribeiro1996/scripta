# Site UI Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A saved `site-ui-reviewer` agent that sweeps the local website signed in as the fixture account (admin included) and writes a harmony/UX/feature-gap report, plus the two scripts it needs: `dev-web.mjs` (signed-in web stack in one command) and `web-snapshot.mjs` (Playwright screenshot + control listing).

**Architecture:** `dev-web.mjs` is `dev-emulator.mjs` minus the device: same slot claim, same `devFixtureSetup.mjs` seeding, the backend spawned detached with `devDataDirEnv()` plus `ADMIN_USER_ID`, then Vite spawned detached from `frontend/`. `web-snapshot.mjs` mirrors `dev-snapshot.mjs`: a thin CLI over a pure module (`webSnapshot.mjs`) that parses args and formats the listing, tested with `node --test`; the CLI drives headless system Chrome through Playwright. The agent file is prose modeled on `beta-tester.md`.

**Tech Stack:** Node ESM scripts, `node:test`, `node:sqlite`, `util.parseEnv`, Playwright (`channel: "chrome"`), Markdown agent definition.

**Spec:** `docs/superpowers/specs/2026-10-25-site-ui-reviewer-design.md`

## Global Constraints

- Reuse `scripts/devFixtureSetup.mjs`, `scripts/devDataDir.mjs`, `scripts/devClaim.mjs` (`claimThisWorktreeSlot`), `scripts/devProcess.mjs` (`spawnDetached`, `waitFor`, `isPortOpen`, `mkdirRuntimeDir`). No second copy of "start a signed-in backend".
- The fixture credential (`scripts/fixtures/account.json` `password`) never reaches stdout, stderr, a URL, or any file except the Playwright session file in the output dir.
- `ADMIN_USER_ID` = the fixture user's id (`users.id` in the dev `auth.sqlite`, looked up by `account.json` `email`), set on the backend `dev-web.mjs` spawns. A backend adopted without it is refused, not reused.
- Web URLs use `localhost` (not `127.0.0.1`; the backend's `FRONTEND_URL` is `http://localhost:<vite>`, `scripts/devSlotEnv.mjs:19`). The scheme is `https` when `mobileCertsExist()` (`scripts/mobileCertPaths.mjs:25`), else `http`. Vite switches to https on its own when the certs exist (`frontend/vite.config.ts:47`). A plain backend doesn't, so in that case `dev-web.mjs` must spawn the backend with `DEV_HTTPS_CERT_PATH`/`DEV_HTTPS_KEY_PATH` and https `FRONTEND_URL`/`PUBLIC_API_URL` (`backend/scripts/dev-mobile.mjs:75-77` is the precedent). Otherwise every API call fails CORS/TLS.
- Vite runs with cwd `frontend/` (`frontend/vite.config.ts` reads `VITE_PORT` via `loadEnv(mode, process.cwd())`).
- Touch-target floor is 44px (`DESIGN.md:68`).
- Playwright: `chromium.launch({ channel: "chrome", headless: true })`, context `serviceWorkers: "block"`, `ignoreHTTPSErrors` only when the web URL is https (the self-signed localhost cert; Playwright can't scope it per host). No browser download.
- No comments in code (`AGENTS.md`). Specific error handling, no bare catch.
- Verify: `npm run test:scripts` for `scripts/`; `npm run check:agents` for `CLAUDE.md`.
- Report output dir: `$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/ui-reviews/<YYYY-MM-DD-HHMM>/`; `/ui-reviews/` in `.gitignore`.

## Review Focus

1. **Refresh-token rotation across snapshots.** Refresh tokens rotate (`backend/src/modules/auth/service.ts:52`) and auth routes are limited to 20/min (`backend/src/modules/auth/plugin.ts:100`). A snapshot that reuses a stale session file, or logs in on every call, ends on the login page or gets 429. Expected: the session file is written back after every snapshot, and login happens only when the file is missing or the page came up signed out. The write-back runs in a `finally`, so a failed step doesn't lose a rotated token. Pinned by Task 3's `sessionState` test and the Task 3 two-snapshots-in-a-row check.
2. **A backend already on the slot from `dev-emulator.mjs`** (right data dir, no `ADMIN_USER_ID`). Expected: `dev-web.mjs` refuses with the mismatch message naming `ADMIN_USER_ID` and `npm run dev:release`. Pinned by Task 1's test.
3. **`--reset` with a backend still running.** Wiping `backend/data/dev` under a live backend leaves it serving deleted files. Expected: `dev-web.mjs --reset` refuses when the slot's backend port is open and tells the caller to run `npm run dev:release`. Pinned by Task 2's manual check.
4. **The page is still rendering when captured** (data arriving after network idle, an entrance animation). Expected: the header says `page was still changing — snapshot again` and nothing is silently captured mid-change. Pinned by Task 3's `formatWebListing` note test and its settle rule.
5. **An interactive element with no accessible name** (icon-only "⋯" or close X). Expected: listed as `(no label)` with its centre, never skipped, and reachable with `--click-at`. Pinned by Task 3's listing and args tests.

---

### Task 1: Adopted-backend check takes the full expected env

**Files:**
- Modify: `scripts/devFixtureSetup.mjs`
- Modify: `scripts/devBackendEnv.mjs`
- Test: `scripts/devBackendEnv.test.mjs`

**Interfaces:**
- Produces: `assertAdoptedBackendMatches(port, log, expected = devDataDirEnv())`. Throws `describeMismatch(port, rows)` when any key of `expected` differs. Existing two-argument callers (`dev-emulator.mjs`, `dev-phone.mjs`) are unchanged.
- Produces: `describeMismatch(port, rows)`. Its first line no longer says "different data directory"; it says the backend "was started with different settings than this script needs". It still lists each row and ends with `npm run dev:release`.

- [ ] **Step 1: Write the failing test** in `scripts/devBackendEnv.test.mjs`

```js
test("an admin id the running backend lacks is a mismatch, named in the message", () => {
  const rows = mismatchedEnv({ AUTH_DB_PATH: "/dev/auth.sqlite" }, { AUTH_DB_PATH: "/dev/auth.sqlite", ADMIN_USER_ID: "u-1" });
  assert.deepEqual(rows, [{ name: "ADMIN_USER_ID", expected: "u-1", actual: null }]);
  const message = describeMismatch(3000, rows);
  assert.match(message, /ADMIN_USER_ID/);
  assert.doesNotMatch(message, /different data directory/);
  assert.match(message, /npm run dev:release/);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test scripts/devBackendEnv.test.mjs`
Expected: FAIL on `doesNotMatch(/different data directory/)`.

- [ ] **Step 3: Generalize the `describeMismatch` wording, and add the `expected` parameter to `assertAdoptedBackendMatches`.** Keep the "couldn't read the environment" log line, but make its "data directory" wording generic too.

- [ ] **Step 4: Run the scripts suite**

Run: `npm run test:scripts`
Expected: PASS. Any existing test that asserted the old wording is updated to the new wording.

- [ ] **Step 5: Commit**

```bash
git add scripts/devBackendEnv.mjs scripts/devBackendEnv.test.mjs scripts/devFixtureSetup.mjs
git commit -m "Let the adopted-backend check compare any expected env, not only data paths"
```

### Task 2: `dev-web.mjs`, a signed-in web stack in one command

**Files:**
- Create: `scripts/devWeb.mjs`
- Test: `scripts/devWeb.test.mjs`
- Create: `scripts/dev-web.mjs`

**Interfaces:**
- Consumes: `assertAdoptedBackendMatches(port, log, expected)` (Task 1).
- Produces (pure, `scripts/devWeb.mjs`):
  - `webUrls({ vitePort: number, apiPort: number, https: boolean }) -> { web: string, api: string }`. Both URLs use `localhost`.
  - `portsFromEnvLocal(text: string) -> { vitePort: number, apiPort: number }`. Uses `util.parseEnv` on `frontend/.env.local` content and reads `VITE_PORT` and `VITE_API_PORT`. Throws `Error` naming the missing key and saying "run node scripts/dev-web.mjs first".
  - `readDevUserId(authDbPath: string, email: string) -> string`. Opens the db with `node:sqlite` `DatabaseSync` (`readOnly: true`), runs `SELECT id FROM users WHERE email = ?`, and closes it. Throws `Error` naming the email when there's no row.
  - `webBackendEnv({ adminUserId: string, https: boolean, vitePort: number, apiPort: number, certPath: string, keyPath: string }) -> Record<string, string>`. Returns `{ ...devDataDirEnv(), ADMIN_USER_ID }`. When `https` is true it also returns `DEV_HTTPS_CERT_PATH: certPath`, `DEV_HTTPS_KEY_PATH: keyPath`, `FRONTEND_URL: "https://localhost:<vitePort>"` and `PUBLIC_API_URL: "https://localhost:<apiPort>"`. This is both the spawn env and the `expected` passed to `assertAdoptedBackendMatches`.
- Produces (CLI): `node scripts/dev-web.mjs [--reset]`. Its last stdout line is `JSON.stringify({ web, api })`. It exits 0 with the backend and Vite left running detached, logging to `join(tmpdir(), "scripta-dev-web")/backend.log` and `vite.log`.

- [ ] **Step 1: Write the failing tests** in `scripts/devWeb.test.mjs`

```js
test("urls use localhost and follow the cert scheme", () => {
  assert.deepEqual(webUrls({ vitePort: 5174, apiPort: 3001, https: false }), { web: "http://localhost:5174", api: "http://localhost:3001" });
  assert.deepEqual(webUrls({ vitePort: 5174, apiPort: 3001, https: true }), { web: "https://localhost:5174", api: "https://localhost:3001" });
});

test("ports come from frontend/.env.local", () => {
  assert.deepEqual(portsFromEnvLocal("VITE_PORT=5174\nVITE_API_PORT=3001\n"), { vitePort: 5174, apiPort: 3001 });
  assert.throws(() => portsFromEnvLocal("VITE_PORT=5174\n"), /VITE_API_PORT.*dev-web\.mjs/s);
});

test("the dev user's id is read by email, and a missing user throws", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "dev-web-")), "auth.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE)");
  db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run("u-1", "scripta-dev@local.test");
  db.close();
  assert.equal(readDevUserId(dbPath, "scripta-dev@local.test"), "u-1");
  assert.throws(() => readDevUserId(dbPath, "nobody@local.test"), /nobody@local\.test/);
});

test("the backend env carries the admin id, and https settings only with certs", () => {
  const base = { adminUserId: "u-1", vitePort: 5174, apiPort: 3001, certPath: "/c.pem", keyPath: "/k.pem" };
  const plain = webBackendEnv({ ...base, https: false });
  assert.equal(plain.ADMIN_USER_ID, "u-1");
  assert.equal(plain.AUTH_DB_PATH, devDataDirEnv().AUTH_DB_PATH);
  assert.equal(plain.DEV_HTTPS_CERT_PATH, undefined);
  assert.equal(plain.FRONTEND_URL, undefined);
  const secure = webBackendEnv({ ...base, https: true });
  assert.equal(secure.DEV_HTTPS_CERT_PATH, "/c.pem");
  assert.equal(secure.DEV_HTTPS_KEY_PATH, "/k.pem");
  assert.equal(secure.FRONTEND_URL, "https://localhost:5174");
  assert.equal(secure.PUBLIC_API_URL, "https://localhost:3001");
});
```

- [ ] **Step 2: Run and see them fail**

Run: `node --test scripts/devWeb.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the four functions in `scripts/devWeb.mjs`**

- [ ] **Step 4: Run and see them pass**

Run: `node --test scripts/devWeb.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write `scripts/dev-web.mjs`**, in this order:
  1. Run `claimThisWorktreeSlot({ repoRoot })` and keep `ports.backend` and `ports.vite`. This also writes `frontend/.env.local`.
  2. If `--reset` and `await isPortOpen(ports.backend)`: throw "a backend is running on <port>; run npm run dev:release before --reset". This goes further than `dev-emulator.mjs`, which wipes under a live backend. That's deliberate.
  3. Run `ensureSharedBuilt`, `resetDevDataIfRequested`, `seedDevAccount`, `seedEditionWorks`, `seedFixtureUsers`, `seedCommunityGraph`, in that order, as `dev-emulator.mjs` `main()` runs them.
  4. Set `id = readDevUserId(devDataDirEnv().AUTH_DB_PATH, account.email)`, where `account` is `scripts/fixtures/account.json`. Then `https = mobileCertsExist()` and `expected = webBackendEnv({ adminUserId: id, https, vitePort: ports.vite, apiPort: ports.backend, certPath: CERT_PATH, keyPath: KEY_PATH })`.
  5. Backend:
     - If the port is open: `assertAdoptedBackendMatches(ports.backend, log, expected)`.
     - Otherwise: `spawnDetached("npm", ["run", "backend"], { cwd: repoRoot, env: { ...process.env, ...expected }, logName: "backend.log", runtimeDir })`, then `waitFor(isPortOpen)` with a 30 s timeout.
  6. Vite: if `ports.vite` is closed, `spawnDetached("npm", ["run", "dev"], { cwd: frontendDir, env: process.env, logName: "vite.log", runtimeDir })`, then `waitFor(isPortOpen)` with a 60 s timeout.
  7. Log a line pointing at `npm run dev:release`. Then print `JSON.stringify(webUrls({ vitePort: ports.vite, apiPort: ports.backend, https }))` as the final line.

  Human-readable progress goes to stderr, so the final stdout line is the JSON alone.

- [ ] **Step 6: Manual check.** Run from the worktree root after `npm run dev:link-deps`:

  1. Run `node scripts/dev-web.mjs --reset`. Expected: exit 0, and the last line parses as JSON with `web` and `api`.
  2. Check admin with a `node -e` that reads `account.json` itself, calls `POST $api/auth/login`, then `GET $api/books/admin` with the bearer token, and prints only `isAdmin`. Expected: `true`.
  3. If this checkout has `.certs/mobile-cert.pem`, the URLs are https. Repeat check 2 with `NODE_TLS_REJECT_UNAUTHORIZED=0`. Expected: `true`. If it doesn't have the certs, record "https path not exercised" in the task report.
  4. Run `node scripts/dev-web.mjs --reset` again while the stack is up. Expected: it refuses with the `npm run dev:release` message.
  5. Run `npm run dev:release`. Then `lsof -nP -iTCP:<vite> -sTCP:LISTEN` should print nothing.

- [ ] **Step 7: Commit**

```bash
git add scripts/devWeb.mjs scripts/devWeb.test.mjs scripts/dev-web.mjs
git commit -m "Add dev-web.mjs: claim, seed, admin backend and Vite in one command"
```

### Task 3: `web-snapshot.mjs`, screenshot plus control listing

**Files:**
- Create: `scripts/webSnapshot.mjs`
- Test: `scripts/webSnapshot.test.mjs`
- Create: `scripts/web-snapshot.mjs`

**Interfaces:**
- Consumes: `portsFromEnvLocal` and `webUrls` from Task 2, and `mobileCertsExist`.
- Produces (pure, `scripts/webSnapshot.mjs`):
  - `parseWebSnapshotArgs(argv: string[]) -> { name, out, path, width, signedOut, steps }`.
    - Usage: `<name> --out <dir> [--path /route] [--width N] [--signed-out]`, followed by steps in order: `--click "<role>:<name>"`, `--click-at <x>,<y>`, `--fill "<label or placeholder>=<text>"`, `--press <key>`, `--wait "<text>"`.
    - Each step is `{ kind: "click" | "clickAt" | "fill" | "press" | "wait", role?, name?, x?, y?, label?, text?, key? }`.
    - Defaults: `path` is `/`, `width` is `1280`. Height is always 900.
    - Throws on a missing name or `--out`, an unknown flag, a `--click` without `:`, a `--click-at` that isn't two integers, or a `--fill` without `=`.
  - `formatWebListing({ name, pngPath, width, height, headings, elements, consoleErrors, failedRequests, note }) -> string`.
    - Header: `<name> · <W>×<H>px · saved <pngPath>`. If `note` is set, append ` · ` and the note.
    - Then one row per heading, `  h<level> "<text>"`.
    - Then one row per element: `  <role> "<name>"` (or `  <role> (no label)`), then `  @<x>,<y>  <w>×<h>px`, where x,y is the centre in viewport CSS px (what `--click-at` takes). Append, as they apply: `  → <href>` for links, `  ⚠ <44px` when `Math.floor(min(w, h)) < 44`, `  (disabled)`, and `  ⚠ under "<label>"`.
    - Roles are ARIA role names, so they paste straight into `--click`: `a[href]` is link, `select` is combobox, a text `input`/`textarea` is textbox, checkbox and radio inputs keep their names, `button` is button, and an explicit `role` attribute wins.
    - Names are clipped at 60 characters, like `dev-snapshot`'s `clip`.
    - Then `console errors (<n>):` and `failed requests (<n>):` blocks, printed only when non-empty.
  - `sessionState(origin: string, loginBody: { user, accessToken, refreshToken }) -> object`. Returns Playwright storage-state JSON: `{ cookies: [], origins: [{ origin, localStorage: [{ name: "kobo_session", value: JSON.stringify(loginBody) }] }] }`. The `kobo_session` key comes from `frontend/src/auth/tokenStore.ts:18`.
- Produces (CLI): `node scripts/web-snapshot.mjs …`. It saves `<out>/<name>.png` (full page) and prints the listing.
  - Signed-in runs read and write `<out>/session.json`.
  - Login is `POST <api>/auth/login`, body `{ identifier: account.username, password: account.password }`. It runs only when `session.json` is missing, or when `localStorage.kobo_session` is absent after the page loads. In that second case it logs in once, writes the file and reloads.
  - After every signed-in run, including one that fails, it writes `context.storageState()` back to `session.json` in a `finally`. Refresh tokens rotate, so losing the rotated one forces a re-login.

- [ ] **Step 1: Write the failing tests** in `scripts/webSnapshot.test.mjs`

```js
test("args keep steps in order and apply defaults", () => {
  const args = parseWebSnapshotArgs(["03-murals", "--out", "/o", "--path", "/murals", "--click", "button:New mural", "--fill", "Title=Summer", "--click-at", "340,24", "--press", "Enter", "--wait", "Summer"]);
  assert.equal(args.width, 1280);
  assert.deepEqual(args.steps.map((s) => s.kind), ["click", "fill", "clickAt", "press", "wait"]);
  assert.deepEqual(args.steps[0], { kind: "click", role: "button", name: "New mural" });
  assert.deepEqual(args.steps[1], { kind: "fill", label: "Title", text: "Summer" });
  assert.deepEqual(args.steps[2], { kind: "clickAt", x: 340, y: 24 });
  assert.throws(() => parseWebSnapshotArgs(["x", "--out", "/o", "--click", "nocolon"]), /--click/);
  assert.throws(() => parseWebSnapshotArgs(["x", "--out", "/o", "--click-at", "12"]), /--click-at/);
  assert.throws(() => parseWebSnapshotArgs(["x"]), /--out/);
});

test("listing flags small, unlabelled, disabled and covered controls", () => {
  const text = formatWebListing({
    name: "07-murals", pngPath: "/o/07-murals.png", width: 360, height: 900,
    headings: [{ level: 1, text: "Murals" }],
    elements: [
      { role: "button", name: "", x: 340, y: 24, w: 32, h: 32 },
      { role: "link", name: "Summer reads", x: 180, y: 200, w: 300, h: 96, href: "/murals/1" },
      { role: "button", name: "Save", x: 180, y: 860, w: 300, h: 52, disabled: true, coveredBy: "Close" },
    ],
    consoleErrors: ["TypeError: x is undefined"], failedRequests: ["GET 500 /murals"], note: "page was still changing — snapshot again",
  });
  assert.match(text, /^07-murals · 360×900px · saved \/o\/07-murals\.png · page was still changing — snapshot again/);
  assert.match(text, /h1 "Murals"/);
  assert.match(text, /button \(no label\)  @340,24  32×32px  ⚠ <44px/);
  assert.match(text, /link "Summer reads"  @180,200  300×96px  → \/murals\/1/);
  assert.match(text, /button "Save"  @180,860  300×52px  \(disabled\)  ⚠ under "Close"/);
  assert.match(text, /console errors \(1\):\n  TypeError/);
  assert.match(text, /failed requests \(1\):\n  GET 500 \/murals/);
});

test("session state seeds kobo_session for the web origin", () => {
  const body = { user: { id: "u-1" }, accessToken: "a", refreshToken: "r" };
  assert.deepEqual(sessionState("http://localhost:5174", body), {
    cookies: [], origins: [{ origin: "http://localhost:5174", localStorage: [{ name: "kobo_session", value: JSON.stringify(body) }] }],
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `node --test scripts/webSnapshot.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the three functions in `scripts/webSnapshot.mjs`**

- [ ] **Step 4: Run and see them pass**

Run: `node --test scripts/webSnapshot.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write `scripts/web-snapshot.mjs`**
  - URLs: from `frontend/.env.local` through `portsFromEnvLocal` and `webUrls`.
  - Browser: launched with the Global Constraints options. The viewport is `{ width, height: 900 }`.
  - Load: `page.goto(web + path, { waitUntil: "networkidle" })`, then run the steps in order:
    - click: `getByRole(role, { name, exact: true }).click()`
    - clickAt: `page.mouse.click(x, y)`
    - fill: `getByLabel(label, { exact: true })`, falling back to `getByPlaceholder(label, { exact: true })` when the label matches nothing, then `.fill(text)`
    - press: `keyboard.press(key)`
    - wait: `getByText(text).first().waitFor({ timeout: 15000 })`

    Wait for `networkidle` again after every click.
  - Settle: wait up to 5 s for `document.getAnimations().length === 0`. Then take viewport screenshots 500 ms apart, up to 4, until two in a row are byte-identical, as `devSnapshot.mjs` compares two captures. If none match, set `note` to `"page was still changing — snapshot again"`.
  - Elements: collect them in the page with `page.evaluate`. Take the visible `a[href]`, `button`, `input`, `select`, `textarea`, `[role=button]`, `[role=link]`, `[role=tab]`, `[role=menuitem]`, `[role=checkbox]`, `[role=switch]` and `[tabindex]:not([tabindex="-1"])`.
    - Role is the explicit `role` attribute, or else derived from the tag.
    - Name is `aria-label`, else `aria-labelledby` text, else the associated `<label>` text, else trimmed `innerText`, else `title`, else `""`.
    - Size comes from `getBoundingClientRect()`.
    - `disabled` is the disabled property or `aria-disabled="true"`.
    - `coveredBy` is the name of the interactive element that `document.elementFromPoint` hits at the element's centre, when that hit is outside this element. This check runs only for centres inside the viewport.
  - Headings: `h1`–`h3`.
  - Errors: collect console `error` messages and failed or ≥400 responses from page load onward. List a response as `<METHOD> <status> <path>`.
  - Screenshot: `page.screenshot({ path, fullPage: true })`.
  - Failures: a step that fails (for example, an element not found) prints the listing of the page as it is. Then it exits 1 with the step and Playwright's message on stderr. A screen that can't be reached must not look like a pass.

- [ ] **Step 6: Manual check.** Run with `out` set to a scratch dir and the stack from `node scripts/dev-web.mjs` up:
  1. `node scripts/web-snapshot.mjs 01-landing --out "$out" --signed-out`. Expected: a PNG, and a listing that includes the landing page's headings.
  2. `node scripts/web-snapshot.mjs 02-library --out "$out" --path /dashboard/library --width 360`, then `node scripts/web-snapshot.mjs 03-library --out "$out" --path /dashboard/library`. Expected: both runs list the library page's controls rather than login fields, and the second run doesn't log in again (temporarily add an stderr line on login, or check the backend log for one `/auth/login`).
  3. `node scripts/web-snapshot.mjs 04-admin --out "$out" --path /admin/genres`. Expected: the admin page's own heading, not the not-found page (a non-admin gets `NotFoundPage` at the same URL, `frontend/src/pages/AdminGenresPage.tsx:17`).
  4. Run `node scripts/web-snapshot.mjs 05-menu --out "$out" --path /dashboard/library --click-at <x>,<y>` on a `(no label)` control from listing 03, if there is one. Expected: the listing shows what it opened.
  5. Run `rg -n "password" scripts/web-snapshot.mjs scripts/webSnapshot.mjs`. Expected: the only use of `account.password` is the `/auth/login` request body, and no log, error message or listing includes the request body.
  6. Run `npm run dev:release`.

- [ ] **Step 7: Commit**

```bash
git add scripts/webSnapshot.mjs scripts/webSnapshot.test.mjs scripts/web-snapshot.mjs
git commit -m "Add web-snapshot.mjs: Playwright screenshot and control listing for the web app"
```

### Task 4: The `site-ui-reviewer` agent

**Files:**
- Create: `.claude/agents/site-ui-reviewer.md`
- Modify: `CLAUDE.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `node scripts/dev-web.mjs [--reset]` (Task 2) and `node scripts/web-snapshot.mjs …` (Task 3), exactly as specified.

- [ ] **Step 1: Write `.claude/agents/site-ui-reviewer.md`.** Frontmatter: `name: site-ui-reviewer`, `tools: Bash, Read, Write`, `model: sonnet`. The description is modeled on `beta-tester`'s: an exploratory sweep of the Scripta website, dispatched only when the user explicitly asks for a site UI review, never to verify a change, given the worktree path and an output directory, never fixes anything.

  The body follows `.claude/agents/beta-tester.md`'s section order. Each section carries the spec's content for it (spec §3), with these specifics:
  - **Setup**
    - If `node scripts/dev-status.mjs --json` shows this worktree already has a stack, run `npm run dev:release` first. Then run `node scripts/dev-web.mjs --reset` and take `web` from its last line. If it refuses (stack limit, load gate), stop and report.
    - Read `DESIGN.md` once.
    - Build the coverage list from the `path=` routes in `frontend/src/App.tsx` (and `frontend/src/AccountApp.tsx` if it declares routes). Each route gets two rows, `@1280` and `@360`. Write `report.md` with every row marked "not reached".
  - **Looking at a page**
    - Explain the `web-snapshot.mjs` command, its steps flags and the listing format, using the example from Task 3's test. To reach an unlabelled control, use `--click-at` with the `@x,y` the listing printed at the same width.
    - A `NN` counter in snapshot names.
    - Read the PNG on a page's first visit at each width, and whenever something visual changed.
    - If the header says "still changing", snapshot again under the same name.
    - If a step exits 1, the page wasn't reached as asked. Retry once, then mark it "partial" with the error.
  - **Sweep**: the spec's steps 1–4.
    - Step 3 reads share links, vote codes, play codes and arena ids off the site's own pages, never from `backend/data` or a `.sqlite` file.
    - Never change the fixture account's password or email, and never delete it.
    - On admin pages, make no decision that changes catalog data beyond what's needed to see a page's states.
  - **What counts as a finding**
    - **Harmony findings:** one per pattern, from the spec's list. Each lists every variant with page and screenshot, names the best one and why, and recommends it everywhere. A `DESIGN.md` rule wins over "most common".
    - **UX findings:** `beta-tester`'s severities and categories. A `⚠ <44px` row is confirmed in the PNG first. A `(no label)` row is checked with `rg` on the component for `aria-label` before it's reported.
    - **Gap findings:** each cites a `mobile/src/app/...` file, and a `frontend/src/pages/...` file or a site route.
    - One cause on several pages is one finding.
    - Append each finding the moment it's confirmed (quoted heredoc), as `beta-tester` does.
  - **Finish:** run `npm run dev:release` whatever happened, rewrite `report.md` in final form, then reply with only its path and its Summary.
  - **Report template**, in this order:
    - title line: `# Site UI review, <YYYY-MM-DD HH:MM>, <branch> @ <short sha>`
    - Summary: counts and three fixes first
    - Harmony
    - UI/UX problems
    - Feature gaps: two tables, columns `Feature | App (file) | Site (file/route) | How central`
    - Console errors and failed requests: a table, `Count | Page | Message`
    - Coverage: `Route | Width | Status | Note`
    - Harness notes and leftover state, ending with "fixture data is dirty; the next pass runs `node scripts/dev-web.mjs --reset`"

- [ ] **Step 2: Add the `CLAUDE.md` subagents-table row**, after the `beta-tester` row:

```markdown
| User explicitly asks for a site UI review, a web UX sweep, or site-vs-app gaps — never otherwise, and never to verify a change | `site-ui-reviewer`; the main session passes its own worktree path and the absolute output dir `$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/ui-reviews/<YYYY-MM-DD-HHMM>/`; send its `report.md` with SendUserFile, then triage it with the user |
```

- [ ] **Step 3: Add `/ui-reviews/` to `.gitignore`**, next to `/beta-tests/`.

- [ ] **Step 4: Verify**

Run: `npm run check:agents && npm run test:scripts`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/site-ui-reviewer.md CLAUDE.md .gitignore
git commit -m "Add the site-ui-reviewer agent"
```
