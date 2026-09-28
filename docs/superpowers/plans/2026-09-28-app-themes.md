# App Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eleven colour themes (plus System) on web and mobile, picked in Settings and synced through the account, all defined once in `@scripta/shared`.

**Architecture:** A theme registry in `packages/shared/src/themes/` holds every palette plus the preference/sync rules. Mobile reads it directly through its `ThemeProvider`; web gets `frontend/src/themes.css` generated from it (one `:root[data-theme="<id>"]` block per theme, checked by a test). The backend stores the preference in a nullable `users.theme` column behind `GET`/`PUT /auth/theme`; each client caches it locally and reconciles with the account on start and on foreground.

**Tech Stack:** TypeScript, Node `node:test`, Fastify + zod 3 + `node:sqlite` (backend), React 19 + Vite + Tailwind v4 + oxlint (web), Expo 57 / React Native 0.86 + AsyncStorage (mobile).

**Spec:** `docs/superpowers/specs/2026-09-28-app-themes-design.md`

## Global Constraints

- Palettes live only in `packages/shared/src/themes/palettes.ts`. No theme-token hex values in web or mobile source except the generated `frontend/src/themes.css`.
- Theme ids, in picker order after System: `light, dark, sepia, rose, midnight, forest, matrix, synthwave, seventies, newsprint, oxblood`.
- Stored preference values are `ThemePreference` strings (`"system"` or a theme id). Local storage key is `theme` on both clients (web `localStorage`, mobile AsyncStorage).
- Copy, exactly: section heading `Appearance`; System tile label `System`; save-failure message `Couldn't save to your account. Try again.`
- Sync/save failures: catch only `ApiError` and `TypeError` (network); let anything else propagate. Background-sync failures show nothing; picker save failures show the message above.
- No comments in code (AGENTS.md). The only exception is the generated-file header in `frontend/src/themes.css`.
- Consumers read `@scripta/shared` from `dist/`: run `npm run build --workspace @scripta/shared` before any consumer typecheck or test.
- Git in this worktree: use `/usr/bin/git` (the `rtk git` wrapper refuses worktrees), stage and commit in one command with explicit paths (other sessions share the index), end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verify per package (AGENTS.md): shared `npm run build --workspace @scripta/shared` + `npm test --workspace @scripta/shared`; backend `npm run typecheck --workspace backend` + `npm test --workspace backend`; web `npm run typecheck --workspace frontend` + `npm run lint --workspace frontend` + `npm test --workspace frontend`; mobile `npm run typecheck --workspace mobile` + `npm test --workspace mobile`. All commands run from the worktree root.

## Review Focus

1. A stale or garbage `localStorage.theme` (a removed theme, a hand edit) must render Light with the `dark:` swaps off, show System selected in the picker, and log nothing — pinned by the `parseThemePreference` test (Task 1) and a manual check in Task 9.
2. Offline or a 5xx during background sync must leave the current theme alone with no error UI and no uncaught rejection — pinned by the `isThemeSyncFailure` filter (Tasks 5 and 7) and an offline check in Task 9.
3. A failed save from the picker must keep the theme applied on this device, show the alert, and let the next foreground sync restore the account's value — manual check in Task 9.
4. Primary buttons on light-accent themes (Midnight, Forest, Matrix, Synthwave, Seventies, Oxblood) must have readable text — pinned by the on-accent guard test (Task 4).
5. The landing toggle with a named theme active must show the icon for that theme's scheme and flip to the opposite default — manual check in Task 9.

---

### Task 1: Shared theme registry

**Files:**
- Create: `packages/shared/src/themes/palettes.ts`
- Create: `packages/shared/src/themes/preference.ts`
- Create: `packages/shared/src/themes/index.ts`
- Test: `packages/shared/src/themes/themes.test.ts`
- Modify: `packages/shared/package.json` (`exports` map)

**Interfaces:**
- Consumes: nothing.
- Produces (import from `@scripta/shared/themes`):
  - `type ThemeScheme = "light" | "dark"`
  - `interface ThemeColors` — 20 string tokens: `background, surface, surfacePressed, text, textDim, border, accent, accentSoft, accentFill, danger, dangerSoft, success, successSoft, info, infoSoft, reference, referenceSoft, scrim, onAccent, onDanger`
  - `interface ThemeDefinition { label: string; scheme: ThemeScheme; colors: ThemeColors }`
  - `const THEME_IDS` (readonly tuple, picker order) and `type ThemeId`
  - `const themes: Record<ThemeId, ThemeDefinition>`
  - `type ThemePreference = ThemeId | "system"` and `const THEME_PREFERENCES` (readonly tuple `["system", ...THEME_IDS]`, usable with `z.enum`)
  - `parseThemePreference(value: unknown): ThemePreference`
  - `resolveTheme(preference: ThemePreference, osScheme: ThemeScheme): ThemeId`
  - `reconcileThemePreference(account: ThemePreference | null, device: ThemePreference): { apply: ThemePreference | null; upload: ThemePreference | null }`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/themes/themes.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { THEME_IDS, themes, type ThemeColors } from "./palettes.js";
import { THEME_PREFERENCES, parseThemePreference, reconcileThemePreference, resolveTheme } from "./preference.js";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

const AA_PAIRS: Array<[keyof ThemeColors, keyof ThemeColors]> = [
  ["text", "background"],
  ["text", "surface"],
  ["textDim", "surface"],
  ["textDim", "background"],
  ["accent", "surface"],
  ["onAccent", "accent"],
  ["onDanger", "danger"],
  ["danger", "surface"],
  ["success", "surface"],
  ["info", "surface"],
  ["reference", "surface"],
  ["accent", "accentSoft"],
  ["danger", "dangerSoft"],
  ["success", "successSoft"],
  ["info", "infoSoft"],
  ["reference", "referenceSoft"],
  ["text", "accentFill"],
];

for (const id of THEME_IDS) {
  test(`${id}: every text pairing reaches 4.5:1`, () => {
    const colors = themes[id].colors;
    for (const [fg, bg] of AA_PAIRS) {
      const ratio = contrast(colors[fg], colors[bg]);
      assert.ok(ratio >= 4.5, `${id} ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${id}: accentFill separates from the page more than a border does`, () => {
    const colors = themes[id].colors;
    assert.ok(contrast(colors.accentFill, colors.background) > contrast(colors.border, colors.background));
  });

  test(`${id}: every colour except scrim is a lowercase six-digit hex`, () => {
    for (const [token, value] of Object.entries(themes[id].colors)) {
      if (token === "scrim") assert.match(value, /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/, `${id}.scrim`);
      else assert.match(value, /^#[0-9a-f]{6}$/, `${id}.${token}`);
    }
  });
}

test("exactly the designed themes use the dark scheme", () => {
  assert.deepEqual(
    THEME_IDS.filter((id) => themes[id].scheme === "dark"),
    ["dark", "midnight", "forest", "matrix", "synthwave", "seventies", "oxblood"],
  );
});

test("THEME_PREFERENCES is system followed by every theme id in picker order", () => {
  assert.deepEqual(THEME_PREFERENCES, ["system", ...THEME_IDS]);
});

test("parseThemePreference keeps valid values and turns anything else into system", () => {
  for (const value of THEME_PREFERENCES) assert.equal(parseThemePreference(value), value);
  for (const value of ["vaporwave", "", "Light", " dark", null, undefined, 3, {}]) assert.equal(parseThemePreference(value), "system");
});

test("resolveTheme follows the OS only for system", () => {
  assert.equal(resolveTheme("system", "light"), "light");
  assert.equal(resolveTheme("system", "dark"), "dark");
  assert.equal(resolveTheme("matrix", "light"), "matrix");
  assert.equal(resolveTheme("sepia", "dark"), "sepia");
});

test("reconcileThemePreference seeds an empty account, ignores a match, and otherwise applies the account", () => {
  assert.deepEqual(reconcileThemePreference(null, "dark"), { apply: null, upload: "dark" });
  assert.deepEqual(reconcileThemePreference(null, "system"), { apply: null, upload: "system" });
  assert.deepEqual(reconcileThemePreference("midnight", "midnight"), { apply: null, upload: null });
  assert.deepEqual(reconcileThemePreference("midnight", "light"), { apply: "midnight", upload: null });
  assert.deepEqual(reconcileThemePreference("system", "oxblood"), { apply: "system", upload: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL — `Cannot find module '.../themes/palettes.js'`.

- [ ] **Step 3: Write the registry**

Create `packages/shared/src/themes/palettes.ts` with exactly this content (values are final and contrast-checked; Light and Dark match `mobile/src/ui/theme.tsx` today):

```ts
export type ThemeScheme = "light" | "dark";

export interface ThemeColors {
  background: string;
  surface: string;
  surfacePressed: string;
  text: string;
  textDim: string;
  border: string;
  accent: string;
  accentSoft: string;
  accentFill: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  info: string;
  infoSoft: string;
  reference: string;
  referenceSoft: string;
  scrim: string;
  onAccent: string;
  onDanger: string;
}

export interface ThemeDefinition {
  label: string;
  scheme: ThemeScheme;
  colors: ThemeColors;
}

export const THEME_IDS = ["light", "dark", "sepia", "rose", "midnight", "forest", "matrix", "synthwave", "seventies", "newsprint", "oxblood"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const themes: Record<ThemeId, ThemeDefinition> = {
  light: {
    label: "Light",
    scheme: "light",
    colors: {
      background: "#f2f0ec",
      surface: "#ffffff",
      surfacePressed: "#f7f5f1",
      text: "#201e1c",
      textDim: "#6b6560",
      border: "#ddd8d0",
      accent: "#97532d",
      accentSoft: "#f1e2d8",
      accentFill: "#e0ccbf",
      danger: "#ae412e",
      dangerSoft: "#f6dfda",
      success: "#47713c",
      successSoft: "#e4efdf",
      info: "#285f7a",
      infoSoft: "#dcebf2",
      reference: "#6b4f8f",
      referenceSoft: "#ebe4f3",
      scrim: "rgba(32, 30, 28, 0.48)",
      onAccent: "#ffffff",
      onDanger: "#ffffff",
    },
  },
  dark: {
    label: "Dark",
    scheme: "dark",
    colors: {
      background: "#141210",
      surface: "#2a2724",
      surfacePressed: "#333029",
      text: "#ece8e3",
      textDim: "#a8a199",
      border: "#45403a",
      accent: "#e08a52",
      accentSoft: "#3a2c22",
      accentFill: "#593b26",
      danger: "#e08072",
      dangerSoft: "#3a2420",
      success: "#8fbf7f",
      successSoft: "#262f21",
      info: "#7fb8d4",
      infoSoft: "#1f2d33",
      reference: "#b9a3d6",
      referenceSoft: "#2c2536",
      scrim: "rgba(0, 0, 0, 0.64)",
      onAccent: "#141210",
      onDanger: "#141210",
    },
  },
  sepia: {
    label: "Sepia",
    scheme: "light",
    colors: {
      background: "#f1e7d0",
      surface: "#faf4e6",
      surfacePressed: "#f4eee0",
      text: "#3b2e20",
      textDim: "#6f5f48",
      border: "#dccdb0",
      accent: "#86562a",
      accentSoft: "#e9dcca",
      accentFill: "#d7c4a8",
      danger: "#ad3f2a",
      dangerSoft: "#f2e0d1",
      success: "#4d6b31",
      successSoft: "#e4e2ce",
      info: "#2d5d70",
      infoSoft: "#d9dcd3",
      reference: "#6a4c84",
      referenceSoft: "#e3d9d6",
      scrim: "rgba(59, 46, 32, 0.48)",
      onAccent: "#ffffff",
      onDanger: "#ffffff",
    },
  },
  rose: {
    label: "Rosé",
    scheme: "light",
    colors: {
      background: "#f6ecec",
      surface: "#fffafa",
      surfacePressed: "#f9f3f4",
      text: "#2a1d22",
      textDim: "#725f67",
      border: "#e8d4d9",
      accent: "#a3335b",
      accentSoft: "#f0dae1",
      accentFill: "#e2c0c9",
      danger: "#b4461e",
      dangerSoft: "#f8e8e4",
      success: "#44703c",
      successSoft: "#e5e7df",
      info: "#285f7a",
      infoSoft: "#dde1e6",
      reference: "#5a4b94",
      referenceSoft: "#e5deea",
      scrim: "rgba(42, 29, 34, 0.48)",
      onAccent: "#ffffff",
      onDanger: "#ffffff",
    },
  },
  midnight: {
    label: "Midnight",
    scheme: "dark",
    colors: {
      background: "#0d121c",
      surface: "#1a2130",
      surfacePressed: "#262d3c",
      text: "#e6e9f0",
      textDim: "#98a2b5",
      border: "#323c52",
      accent: "#dcae62",
      accentSoft: "#36312a",
      accentFill: "#534734",
      danger: "#ee8a7c",
      dangerSoft: "#3a2a2f",
      success: "#8cc79a",
      successSoft: "#263635",
      info: "#86b4e8",
      infoSoft: "#253245",
      reference: "#bba8ea",
      referenceSoft: "#303045",
      scrim: "rgba(0, 0, 0, 0.64)",
      onAccent: "#0d121c",
      onDanger: "#0d121c",
    },
  },
  forest: {
    label: "Forest",
    scheme: "dark",
    colors: {
      background: "#0e1612",
      surface: "#19241e",
      surfacePressed: "#253029",
      text: "#e5eadd",
      textDim: "#9eac9c",
      border: "#304238",
      accent: "#b3d36a",
      accentSoft: "#2f3c24",
      accentFill: "#465630",
      danger: "#ef8c7a",
      dangerSoft: "#3b2e27",
      success: "#72d0ad",
      successSoft: "#223b31",
      info: "#94aaea",
      infoSoft: "#29343d",
      reference: "#c7a6de",
      referenceSoft: "#33333b",
      scrim: "rgba(0, 0, 0, 0.64)",
      onAccent: "#0e1612",
      onDanger: "#0e1612",
    },
  },
  matrix: {
    label: "Matrix",
    scheme: "dark",
    colors: {
      background: "#020805",
      surface: "#08170e",
      surfacePressed: "#122419",
      text: "#b6f5c4",
      textDim: "#62ad7c",
      border: "#174a2c",
      accent: "#3cff7d",
      accentSoft: "#0e391d",
      accentFill: "#165c2e",
      danger: "#ff6b6b",
      dangerSoft: "#351c19",
      success: "#5ce1e6",
      successSoft: "#143332",
      info: "#79a8ff",
      infoSoft: "#1a2837",
      reference: "#d38cff",
      referenceSoft: "#2c2237",
      scrim: "rgba(0, 0, 0, 0.64)",
      onAccent: "#020805",
      onDanger: "#020805",
    },
  },
  synthwave: {
    label: "Synthwave",
    scheme: "dark",
    colors: {
      background: "#150d28",
      surface: "#22163b",
      surfacePressed: "#2f2347",
      text: "#f7edff",
      textDim: "#b6a0da",
      border: "#402d66",
      accent: "#ff4fb8",
      accentSoft: "#441a45",
      accentFill: "#652359",
      danger: "#ff7f4d",
      dangerSoft: "#44242f",
      success: "#5ef2b0",
      successSoft: "#243b43",
      info: "#40d6f2",
      infoSoft: "#1e3550",
      reference: "#b9a0ff",
      referenceSoft: "#362a53",
      scrim: "rgba(0, 0, 0, 0.64)",
      onAccent: "#150d28",
      onDanger: "#150d28",
    },
  },
  seventies: {
    label: "Seventies",
    scheme: "dark",
    colors: {
      background: "#23160d",
      surface: "#342214",
      surfacePressed: "#402e1f",
      text: "#f7e7c6",
      textDim: "#c4a57c",
      border: "#533a24",
      accent: "#e9b43c",
      accentSoft: "#4b3616",
      accentFill: "#664c1d",
      danger: "#f5775a",
      dangerSoft: "#4d291c",
      success: "#a9bf5c",
      successSoft: "#3e381d",
      info: "#79b9c9",
      infoSoft: "#343733",
      reference: "#d3a3c9",
      referenceSoft: "#463233",
      scrim: "rgba(0, 0, 0, 0.64)",
      onAccent: "#23160d",
      onDanger: "#23160d",
    },
  },
  newsprint: {
    label: "Newsprint",
    scheme: "light",
    colors: {
      background: "#ece9e1",
      surface: "#f7f5ef",
      surfacePressed: "#f0eee8",
      text: "#161514",
      textDim: "#5c5953",
      border: "#d6d2c8",
      accent: "#1f1e1c",
      accentSoft: "#d4d3cd",
      accentFill: "#bbb8b2",
      danger: "#b3302a",
      dangerSoft: "#eedbd5",
      success: "#3f6b3a",
      successSoft: "#dbe0d4",
      info: "#2b5a78",
      infoSoft: "#d6dcdc",
      reference: "#664b8a",
      referenceSoft: "#e0dadf",
      scrim: "rgba(22, 21, 20, 0.48)",
      onAccent: "#ffffff",
      onDanger: "#ffffff",
    },
  },
  oxblood: {
    label: "Oxblood",
    scheme: "dark",
    colors: {
      background: "#1c0c0e",
      surface: "#2c1518",
      surfacePressed: "#382123",
      text: "#f4e4d2",
      textDim: "#c29f93",
      border: "#4d2a2e",
      accent: "#d9b36b",
      accentSoft: "#422d21",
      accentFill: "#5c452e",
      danger: "#ff8a6e",
      dangerSoft: "#492521",
      success: "#9fc48a",
      successSoft: "#363127",
      info: "#8fb8d8",
      infoSoft: "#332e36",
      reference: "#c9a8e0",
      referenceSoft: "#3f2b38",
      scrim: "rgba(0, 0, 0, 0.64)",
      onAccent: "#1c0c0e",
      onDanger: "#1c0c0e",
    },
  },
};
```

Create `packages/shared/src/themes/preference.ts`:

```ts
import { THEME_IDS, type ThemeId, type ThemeScheme } from "./palettes.js";

export type ThemePreference = ThemeId | "system";

export const THEME_PREFERENCES = ["system", ...THEME_IDS] as const;

export function parseThemePreference(value: unknown): ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value) ? (value as ThemePreference) : "system";
}

export function resolveTheme(preference: ThemePreference, osScheme: ThemeScheme): ThemeId {
  return preference === "system" ? osScheme : preference;
}

export function reconcileThemePreference(
  account: ThemePreference | null,
  device: ThemePreference,
): { apply: ThemePreference | null; upload: ThemePreference | null } {
  if (account === null) return { apply: null, upload: device };
  if (account === device) return { apply: null, upload: null };
  return { apply: account, upload: null };
}
```

Create `packages/shared/src/themes/index.ts`:

```ts
export * from "./palettes.js";
export * from "./preference.js";
```

In `packages/shared/package.json`, add this entry to `exports` directly after the `"./readerCards"` entry (keep the JSON valid — add the comma after the `"./readerCards"` object):

```json
    "./themes": {
      "types": "./dist/themes/index.d.ts",
      "default": "./dist/themes/index.js"
    }
```

- [ ] **Step 4: Run tests and build**

Run: `npm test --workspace @scripta/shared && npm run build --workspace @scripta/shared && ls packages/shared/dist/themes`
Expected: all tests PASS (the 11 themes × 3 per-theme tests plus the 5 others); `dist/themes` lists `index.js`, `palettes.js`, `preference.js` and their `.d.ts`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/shared/src/themes packages/shared/package.json && /usr/bin/git commit -m "Add the shared theme registry: eleven palettes and the sync rule

Every palette is checked for AA text contrast and for accentFill
outranking a border, so a new theme can't ship unreadable. The account
wins over the device; an empty account is seeded from the device so
existing light/dark choices carry over.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- packages/shared/src/themes packages/shared/package.json
```

---

### Task 2: Backend theme storage and routes

**Files:**
- Modify: `backend/src/modules/auth/domain/types.ts` (`UserRow`)
- Modify: `backend/src/modules/auth/domain/ports.ts` (`AuthRepository`)
- Modify: `backend/src/modules/auth/adapters/sqlite/schema.sql` (users table)
- Modify: `backend/src/modules/auth/adapters/sqlite/connection.ts` (`applyAuthMigrations`)
- Modify: `backend/src/modules/auth/adapters/sqlite/sqliteAuthRepository.ts`
- Modify: `backend/src/modules/auth/service.ts` (`AuthService` + `createAuthService`)
- Modify: `backend/src/modules/auth/routes.ts`
- Test: `backend/src/modules/auth/adapters/sqlite/sqliteAuthRepository.test.ts`, `backend/src/modules/auth/service.test.ts`, `backend/src/modules/auth/routes.test.ts` (all already in backend's `test` list — no new files)

**Interfaces:**
- Consumes: `THEME_PREFERENCES`, `parseThemePreference`, `type ThemePreference` from `@scripta/shared/themes` (Task 1).
- Produces (HTTP, consumed by Tasks 5 and 7):
  - `GET /auth/theme` (Bearer token) → `200 { theme: ThemePreference | null }`; `401` without a valid token.
  - `PUT /auth/theme` (Bearer token), JSON body `{ theme: ThemePreference }` → `204`; `400 { error: "Unknown theme." }` for anything else; `401` without a valid token.

- [ ] **Step 1: Write the failing repository tests**

Append to `backend/src/modules/auth/adapters/sqlite/sqliteAuthRepository.test.ts`:

```ts
test("a fresh database has the theme column", () => {
  assert.ok(columnNames(freshDb(), "users").includes("theme"));
});

test("migrating a database without the theme column adds it, NULL for existing users, and setTheme persists", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT UNIQUE,
      password_hash TEXT, google_id TEXT UNIQUE, avatar_id TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  db.prepare(`INSERT INTO users (id, email, username, password_hash) VALUES ('u1','a@b.c','andre','x')`).run();

  applyAuthMigrations(db);

  assert.ok(columnNames(db, "users").includes("theme"));
  const repo = createSqliteAuthRepository(db);
  assert.equal(repo.findUserById("u1")?.theme, null);
  repo.setTheme("u1", "midnight");
  assert.equal(repo.findUserById("u1")?.theme, "midnight");
});
```

- [ ] **Step 2: Write the failing service tests**

In `backend/src/modules/auth/service.test.ts`, inside `createInMemoryRepo()`'s returned object, add after `markEmailVerified() { ... },`:

```ts
    setTheme(userId, theme) {
      const row = rows.get(userId);
      if (row) rows.set(userId, { ...row, theme });
    },
```

Append these tests at the end of the file (`makeService()` already exists at line ~152 and returns `{ service, repo, blobStore }`):

```ts
test("getTheme is null until a theme is saved, then returns it", () => {
  const { service, repo } = makeService();
  const row = repo.createUser({ email: "t@example.test", username: "themer", passwordHash: null, googleId: null });
  assert.equal(service.getTheme(row.id), null);
  service.setTheme(row.id, "oxblood");
  assert.equal(service.getTheme(row.id), "oxblood");
  service.setTheme(row.id, "system");
  assert.equal(service.getTheme(row.id), "system");
});

test("getTheme reads a stored value this server no longer knows as system", () => {
  const { service, repo } = makeService();
  const row = repo.createUser({ email: "old@example.test", username: "oldtheme", passwordHash: null, googleId: null });
  repo.rows.set(row.id, { ...row, theme: "vaporwave" });
  assert.equal(service.getTheme(row.id), "system");
});

test("getTheme is null for an unknown user", () => {
  const { service } = makeService();
  assert.equal(service.getTheme("nobody"), null);
});
```

- [ ] **Step 3: Write the failing route tests**

In `backend/src/modules/auth/routes.test.ts`, add `import type { ThemePreference } from "@scripta/shared/themes";` next to the other `import type` lines, then append:

```ts
function themeService(stored: Map<string, ThemePreference>): AuthService {
  return {
    getTheme: (userId: string) => stored.get(userId) ?? null,
    setTheme: (userId: string, theme: ThemePreference) => {
      stored.set(userId, theme);
    },
  } as unknown as AuthService;
}

async function callThemeRoute(service: AuthService, options: InjectOptions, token?: string) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (candidate: string) => (candidate === "valid-token" ? user : null));
  await app.register(buildAuthRoutes(service));
  const res = await app.inject(token ? { ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } } : options);
  await app.close();
  return { status: res.statusCode, body: res.body ? (res.json() as Record<string, unknown>) : null };
}

test("theme routes reject a request without a valid access token", async () => {
  const service = themeService(new Map());
  assert.equal((await callThemeRoute(service, { method: "GET", url: "/auth/theme" })).status, 401);
  assert.equal((await callThemeRoute(service, { method: "PUT", url: "/auth/theme", payload: { theme: "dark" } })).status, 401);
  assert.equal((await callThemeRoute(service, { method: "GET", url: "/auth/theme" }, "forged")).status, 401);
});

test("GET /auth/theme is null for an account that never chose one", async () => {
  const { status, body } = await callThemeRoute(themeService(new Map()), { method: "GET", url: "/auth/theme" }, "valid-token");
  assert.equal(status, 200);
  assert.deepEqual(body, { theme: null });
});

test("PUT then GET /auth/theme round-trips the preference for the signed-in user", async () => {
  const stored = new Map<string, ThemePreference>();
  const service = themeService(stored);
  const put = await callThemeRoute(service, { method: "PUT", url: "/auth/theme", payload: { theme: "midnight" } }, "valid-token");
  assert.equal(put.status, 204);
  assert.equal(stored.get(user.id), "midnight");
  const get = await callThemeRoute(service, { method: "GET", url: "/auth/theme" }, "valid-token");
  assert.deepEqual(get.body, { theme: "midnight" });
  assert.equal((await callThemeRoute(service, { method: "PUT", url: "/auth/theme", payload: { theme: "system" } }, "valid-token")).status, 204);
  assert.equal(stored.get(user.id), "system");
});

test("PUT /auth/theme rejects anything that is not a known preference", async () => {
  const stored = new Map<string, ThemePreference>();
  const service = themeService(stored);
  for (const payload of [{ theme: "vaporwave" }, { theme: "Light" }, { theme: null }, {}, { theme: 3 }]) {
    const { status, body } = await callThemeRoute(service, { method: "PUT", url: "/auth/theme", payload }, "valid-token");
    assert.equal(status, 400, JSON.stringify(payload));
    assert.deepEqual(body, { error: "Unknown theme." });
  }
  assert.equal(stored.size, 0);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm test --workspace backend`
Expected: FAIL — typecheck-free `tsx` still runs, so expect failures such as `repo.setTheme is not a function`, `service.getTheme is not a function`, and 404s from the route tests.

- [ ] **Step 5: Implement storage**

`backend/src/modules/auth/domain/types.ts` — in `UserRow`, after `email_verified_at?: string | null;` add:

```ts
  theme?: string | null;
```

`backend/src/modules/auth/domain/ports.ts` — in `AuthRepository`, after `setAvatarId(userId: string, avatarId: string | null): void;` add:

```ts
  setTheme(userId: string, theme: string): void;
```

`backend/src/modules/auth/adapters/sqlite/schema.sql` — in `CREATE TABLE IF NOT EXISTS users`, after the `dashboard_seen_at TEXT, ...` line add:

```sql
  theme         TEXT,
```

`backend/src/modules/auth/adapters/sqlite/connection.ts` — inside the existing `if (columns.length > 0) { ... }` block, after the `dashboard_seen_at` line add:

```ts
    if (!columns.some((column) => column.name === "theme")) db.exec("ALTER TABLE users ADD COLUMN theme TEXT");
```

`backend/src/modules/auth/adapters/sqlite/sqliteAuthRepository.ts` — after `const setAvatarIdStmt = ...` add:

```ts
  const setThemeStmt = db.prepare(`UPDATE users SET theme = ? WHERE id = ?`);
```

and in the returned object, after the `setAvatarId(userId, avatarId) { ... },` method add:

```ts
    setTheme(userId, theme) {
      setThemeStmt.run(theme, userId);
    },
```

- [ ] **Step 6: Implement the service**

`backend/src/modules/auth/service.ts` — add the import after the existing imports:

```ts
import { parseThemePreference, type ThemePreference } from "@scripta/shared/themes";
```

In `interface AuthService`, after `getUserById(userId: string): AuthenticatedUser | null;` add:

```ts
  getTheme(userId: string): ThemePreference | null;
  setTheme(userId: string, theme: ThemePreference): void;
```

In `createAuthService`'s returned object, after the `getUserById(userId) { ... },` method add:

```ts
    getTheme(userId) {
      const theme = repo.findUserById(userId)?.theme;
      return theme == null ? null : parseThemePreference(theme);
    },

    setTheme(userId, theme) {
      repo.setTheme(userId, theme);
    },
```

- [ ] **Step 7: Implement the routes**

`backend/src/modules/auth/routes.ts` — add after `import { RECOVERY_MESSAGE } from "@scripta/shared";`:

```ts
import { THEME_PREFERENCES } from "@scripta/shared/themes";
```

After `const avatarIdParamSchema = ...` add:

```ts
const setThemeSchema = z.object({ theme: z.enum(THEME_PREFERENCES) });
```

Directly after the `app.post("/auth/username", ...)` route block add:

```ts
    app.get("/auth/theme", { preHandler: authGuard }, async (request) => ({ theme: service.getTheme(request.user.id) }));

    app.put("/auth/theme", { preHandler: authGuard }, async (request, reply) => {
      const parsed = setThemeSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Unknown theme." });
      service.setTheme(request.user.id, parsed.data.theme);
      return reply.code(204).send();
    });
```

- [ ] **Step 8: Run typecheck and tests**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: typecheck exits 0; all tests PASS, including the 10 new ones.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add backend/src/modules/auth && /usr/bin/git commit -m "Store the theme preference on the account

A nullable users.theme column behind GET/PUT /auth/theme. It stays out of
AuthenticatedUser and the JWT so a theme change never needs a token
reissue; a stored id this server no longer knows reads back as system
rather than leaking through raw.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/modules/auth
```

---

### Task 3: Web generated theme CSS, boot script and docs

**Files:**
- Create: `frontend/scripts/themesCss.mts` (pure renderer)
- Create: `frontend/scripts/generate-themes-css.mts` (writes the file)
- Create: `frontend/src/themes.css` (generated, committed)
- Test: `frontend/scripts/test-themes-css.mts`
- Modify: `frontend/package.json` (`themes` script)
- Modify: `frontend/src/index.css` (lines 3 and 44–95)
- Modify: `frontend/index.html` (boot script)
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: `THEME_IDS`, `themes`, `type ThemeColors` from `@scripta/shared/themes`.
- Produces: `renderThemesCss(): string`; CSS variables `--color-bg, --color-surface, --color-surface-hover, --color-text, --color-text-dim, --color-border, --color-accent, --color-accent-soft, --color-on-accent, --color-danger, --color-danger-soft, --color-success, --color-success-soft, --color-info, --color-info-soft, --color-reference, --color-reference-soft, --color-on-danger` for every `data-theme`; the Tailwind `dark:` variant active for every dark-scheme theme.

- [ ] **Step 1: Write the failing test**

Create `frontend/scripts/test-themes-css.mts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { THEME_IDS, themes } from "@scripta/shared/themes";
import { renderThemesCss } from "./themesCss.mts";

test("src/themes.css matches the shared theme registry", () => {
  const committed = readFileSync(new URL("../src/themes.css", import.meta.url), "utf8");
  assert.equal(committed, renderThemesCss(), "src/themes.css is stale: run `npm run themes --workspace frontend`");
});

test("the dark variant covers exactly the dark-scheme themes", () => {
  const variant = renderThemesCss().split("\n").find((line) => line.startsWith("@custom-variant dark"));
  assert.ok(variant);
  for (const id of THEME_IDS) assert.equal(variant.includes(`[data-theme="${id}"]`), themes[id].scheme === "dark", id);
});

test("every theme gets a block that sets its colour scheme and accent", () => {
  const css = renderThemesCss();
  for (const id of THEME_IDS) {
    const block = css.split(`:root[data-theme="${id}"] {`)[1]?.split("}")[0] ?? "";
    assert.match(block, new RegExp(`color-scheme: ${themes[id].scheme};`), id);
    assert.match(block, new RegExp(`--color-accent: ${themes[id].colors.accent};`), id);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace frontend`
Expected: FAIL — `Cannot find module './themesCss.mts'`.

- [ ] **Step 3: Write the renderer and generator**

Create `frontend/scripts/themesCss.mts`:

```ts
import { THEME_IDS, themes, type ThemeColors } from "@scripta/shared/themes";

const WEB_TOKENS: Array<[keyof ThemeColors, string]> = [
  ["background", "--color-bg"],
  ["surface", "--color-surface"],
  ["surfacePressed", "--color-surface-hover"],
  ["text", "--color-text"],
  ["textDim", "--color-text-dim"],
  ["border", "--color-border"],
  ["accent", "--color-accent"],
  ["accentSoft", "--color-accent-soft"],
  ["onAccent", "--color-on-accent"],
  ["danger", "--color-danger"],
  ["dangerSoft", "--color-danger-soft"],
  ["success", "--color-success"],
  ["successSoft", "--color-success-soft"],
  ["info", "--color-info"],
  ["infoSoft", "--color-info-soft"],
  ["reference", "--color-reference"],
  ["referenceSoft", "--color-reference-soft"],
  ["onDanger", "--color-on-danger"],
];

function declarations(colors: ThemeColors): string {
  return WEB_TOKENS.map(([token, name]) => `  ${name}: ${colors[token]};`).join("\n");
}

export function renderThemesCss(): string {
  const darkSelectors = THEME_IDS.filter((id) => themes[id].scheme === "dark")
    .map((id) => `[data-theme="${id}"], [data-theme="${id}"] *`)
    .join(", ");
  const blocks = THEME_IDS.map((id) => `:root[data-theme="${id}"] {\n  color-scheme: ${themes[id].scheme};\n${declarations(themes[id].colors)}\n}\n`);
  return [
    "/* Generated from @scripta/shared/themes by `npm run themes --workspace frontend`. Do not edit. */\n",
    `@custom-variant dark (&:where(${darkSelectors}));\n`,
    `@theme {\n${declarations(themes.light.colors)}\n}\n`,
    ":root {\n  color-scheme: light;\n}\n",
    ...blocks,
  ].join("\n");
}
```

Create `frontend/scripts/generate-themes-css.mts`:

```ts
import { writeFileSync } from "node:fs";
import { renderThemesCss } from "./themesCss.mts";

writeFileSync(new URL("../src/themes.css", import.meta.url), renderThemesCss());
```

In `frontend/package.json` `scripts`, add after `"test": ...`:

```json
    "themes": "tsx scripts/generate-themes-css.mts",
```

- [ ] **Step 4: Generate the CSS and wire it in**

Run: `npm run build --workspace @scripta/shared && npm run themes --workspace frontend`
Expected: `frontend/src/themes.css` created, starting with the generated-file header.

Edit `frontend/src/index.css`:
- Line 2: insert `@import "./themes.css";` directly after `@import "tailwindcss";`.
- Delete line 3: `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`
- Replace the whole `@theme { ... }` block (from `@theme {` through its closing `}`, which contains `--font-display` and all the `--color-*` lines plus the comment about `--color-success`) with:

```css
@theme {
  --font-display: "Playfair Display", ui-serif, Georgia, serif;
}
```

- Delete the `:root { color-scheme: light; }` block and the whole `:root[data-theme="dark"] { ... }` block that follow it. Do not touch the later `:root { accent-color: var(--color-accent); }` block.

- [ ] **Step 5: Update the boot script**

In `frontend/index.html`, replace the body of the inline boot script so it reads:

```html
    <script>
      (function () {
        var stored = null;
        try {
          stored = localStorage.getItem("theme");
        } catch (err) {}
        document.documentElement.dataset.theme =
          stored && stored !== "system"
            ? stored
            : matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light";
      })();
    </script>
```

- [ ] **Step 6: Run tests, typecheck, lint, and prove Tailwind picked up the imported variant**

Run: `npm test --workspace frontend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm run build --workspace frontend && grep -c 'data-theme=.\?midnight' frontend/dist/assets/*.css`
Expected: tests PASS; typecheck and lint exit 0 (lint's existing warnings in untouched files are fine); the grep prints a count ≥ 2 (the `midnight` variables block and the `dark:` variant selectors). If the count is 0, Tailwind did not process `@custom-variant`/`@theme` from the imported file — stop and report BLOCKED with the build output; do not work around it.

- [ ] **Step 7: Update DESIGN.md**

Replace this sentence on line 7:

`One palette, byte-identical between web's Tailwind v4 \`@theme\` block (plus its \`:root[data-theme="dark"]\` override) and mobile's \`palettes\` object.`

with:

`One theme registry, \`packages/shared/src/themes/palettes.ts\`, read directly by mobile and by web through \`frontend/src/themes.css\`, which \`npm run themes --workspace frontend\` generates from it (a web test fails if it goes stale).`

and in the same line replace `` (`frontend/src/index.css`, `mobile/src/ui/theme.tsx`, and the component files cited per section) `` with `` (`packages/shared/src/themes/palettes.ts` and the component files cited per section) ``.

Insert directly above `### Tier-rank colors (not theme tokens — per-tierlist mutable data, default presets)`:

```markdown
### Themes

The table above is the default Light/Dark pair. The registry defines eleven themes with the same tokens: Light, Sepia, Rosé and Newsprint use the light scheme; Dark, Midnight, Forest, Matrix, Synthwave, Seventies and Oxblood use the dark scheme. Settings → Appearance picks one, or System (Light or Dark from the OS). The choice is cached per device under `theme` and synced through `GET`/`PUT /auth/theme` while signed in; the account wins. Every theme passes the AA pairs in `packages/shared/src/themes/themes.test.ts`. Dark-scheme themes get the reversed reader-card print and Tailwind's `dark:` variant. Text on an `accent` or `danger` fill is always `on-accent` / `on-danger`, never white.

```

On line 94, replace `The theme follows the OS until the landing header's toggle picks one;` with `The theme follows the OS until the landing header's toggle (light/dark) or Settings → Appearance (any theme) picks one;`.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add frontend/scripts/themesCss.mts frontend/scripts/generate-themes-css.mts frontend/scripts/test-themes-css.mts frontend/src/themes.css frontend/src/index.css frontend/index.html frontend/package.json DESIGN.md && /usr/bin/git commit -m "Generate the web theme CSS from the shared registry

index.css stops hand-copying the palette: themes.css carries one block per
theme plus the dark variant for every dark-scheme theme, so the existing
dark:hidden plate swaps cover Midnight, Matrix and the rest unchanged. The
boot script now treats system like a missing choice; an unknown id matches
no block and renders as Light.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/scripts/themesCss.mts frontend/scripts/generate-themes-css.mts frontend/scripts/test-themes-css.mts frontend/src/themes.css frontend/src/index.css frontend/index.html frontend/package.json DESIGN.md
```

---

### Task 4: Web text on accent and danger fills

**Files:**
- Test: `frontend/scripts/test-on-accent-text.mts`
- Modify: the ~30 files the test lists (today: `OwnShelfView.tsx`, `LibraryPage.tsx`, `ArenaViewPage.tsx`, `VoteTierlistPage.tsx`, `TierListEditorPage.tsx`, `MuralEditorPage.tsx`, `AddBooksSheet.tsx`, `BracketMap.tsx`, `ShareModal.tsx`, `ConfirmDialog.tsx`, `BookCard.tsx`, `AddBookModal.tsx`, `TierListCreatePage.tsx`, `SettingsPage.tsx`, `NotFoundPage.tsx`, `MuralsListPage.tsx`, `HomePage.tsx`, `GroupsPage.tsx`, `GalleryPage.tsx`, `ArenaSeedPage.tsx`, `MobileMuralCanvas.tsx`, `BlockConfigPanel.tsx`, `AddBlockMenu.tsx`, `landing/TournamentBracket.tsx`, `SeedSlotGrid.tsx`, `SyncGoodreadsModal.tsx`, `SocialsSection.tsx`, `FinishSheet.tsx`, `Avatar.tsx`, `AddBookSheet.tsx`)

**Interfaces:**
- Consumes: `--color-on-accent`, `--color-on-danger` (Task 3; they already exist today too).
- Produces: nothing new.

- [ ] **Step 1: Write the failing guard test**

Create `frontend/scripts/test-on-accent-text.mts`:

```ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const FILLS = ["bg-(--color-accent)", "bg-(--color-danger)"];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

test("no class string puts hardcoded white text on an accent or danger fill", () => {
  const offenders: string[] = [];
  for (const file of tsxFiles(SRC)) {
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      for (const segment of line.split(/["`]|\$\{|\}/)) {
        if (FILLS.some((fill) => segment.includes(fill)) && /\btext-white\b/.test(segment)) offenders.push(`${file.slice(SRC.length)}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [], "use text-(--color-on-accent) on accent fills and text-(--color-on-danger) on danger fills");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace frontend`
Expected: FAIL listing roughly 44 `file:line` offenders.

- [ ] **Step 3: Fix every offender**

For each listed line:
- Where the same class string has `bg-(--color-accent)` (including `hover:bg-(--color-accent)`), replace `text-white` with `text-(--color-on-accent)`, keeping any matching prefix (`hover:text-white` → `hover:text-(--color-on-accent)`, `text-white/80` → `text-(--color-on-accent)/80`).
- Where it has `bg-(--color-danger)`, use `text-(--color-on-danger)` the same way.
- `frontend/src/components/BookCard.tsx` lines ~342 and ~354 share one `text-white` between an accent branch and a dark-scrim branch. Move the text colour into each branch, e.g. line ~342 becomes:

```tsx
              className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold backdrop-blur-xs ${book._style ? "bg-(--color-accent) text-(--color-on-accent)" : "bg-[rgba(10,8,6,0.72)] text-white"}`}
```

  and line ~354 the same with `book._coverImageId`. The scrim branch keeps `text-white` (the scrim is theme-independent).
- Leave `text-white` alone wherever the fill is a fixed dark scrim (`bg-[rgba(10,8,6,...)]`, `bg-black/50`) or per-tierlist tier colours — those are not theme tokens.

Also scan for multi-line class strings the guard can't see:

Run: `grep -rn -A2 'bg-(--color-accent)\|bg-(--color-danger)' frontend/src --include='*.tsx' | grep 'text-white'`
Expected after the fix: only lines whose `text-white` belongs to a scrim/tier-colour branch as described above. Fix any other hit the same way.

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npm test --workspace frontend && npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: all PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add frontend/scripts/test-on-accent-text.mts frontend/src && /usr/bin/git commit -m "Use on-accent/on-danger text on accent and danger fills

Hardcoded white was already about 2.6:1 on Dark's accent and would be
unreadable on the brass, fern, phosphor and mustard accents of the new
dark themes. A web test now fails if white text comes back onto either
fill in the same class string.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/scripts/test-on-accent-text.mts frontend/src
```

---

### Task 5: Web theme runtime, account sync and landing toggle

**Files:**
- Create: `frontend/src/lib/theme.ts`
- Create: `frontend/src/api/theme.ts`
- Create: `frontend/src/hooks/useAccountThemeSync.ts`
- Modify: `frontend/src/layouts/DashboardLayout.tsx:67-70`
- Modify: `frontend/src/components/landing/ThemeToggle.tsx`

**Interfaces:**
- Consumes: `parseThemePreference`, `resolveTheme`, `reconcileThemePreference`, `themes`, `type ThemePreference`, `type ThemeScheme` (Task 1); `GET`/`PUT /auth/theme` (Task 2); `apiFetch`, `ApiError` from `frontend/src/api/client.ts`.
- Produces (used by Task 6):
  - `lib/theme.ts`: `osScheme(): ThemeScheme`, `readThemePreference(): ThemePreference`, `applyThemePreference(preference: ThemePreference): void`, `useThemePreference(): ThemePreference`
  - `api/theme.ts`: `fetchAccountTheme(): Promise<ThemePreference | null>`, `saveAccountTheme(theme: ThemePreference): Promise<void>`, `isThemeSyncFailure(err: unknown): boolean`
  - `hooks/useAccountThemeSync.ts`: `useAccountThemeSync(): void`

These are DOM/React glue with no DOM test harness in this package (web tests run in plain Node); their logic lives in the Task 1 functions, which are tested. Verification here is typecheck, lint, and the Task 9 browser pass.

- [ ] **Step 1: Write `lib/theme.ts`**

```ts
import { useSyncExternalStore } from "react";
import { parseThemePreference, resolveTheme, type ThemePreference, type ThemeScheme } from "@scripta/shared/themes";

const STORAGE_KEY = "theme";
const CHANGE_EVENT = "themechange";

export function osScheme(): ThemeScheme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(STORAGE_KEY));
  } catch (err) {
    if (err instanceof DOMException) return "system";
    throw err;
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference, osScheme());
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readThemePreference);
}
```

- [ ] **Step 2: Write `api/theme.ts`**

```ts
import { parseThemePreference, type ThemePreference } from "@scripta/shared/themes";
import { ApiError, apiFetch } from "./client";

export async function fetchAccountTheme(): Promise<ThemePreference | null> {
  const body = (await apiFetch("/auth/theme")) as { theme: unknown };
  return body.theme === null ? null : parseThemePreference(body.theme);
}

export async function saveAccountTheme(theme: ThemePreference): Promise<void> {
  await apiFetch("/auth/theme", { method: "PUT", body: JSON.stringify({ theme }) });
}

export function isThemeSyncFailure(err: unknown): boolean {
  return err instanceof ApiError || err instanceof TypeError;
}
```

- [ ] **Step 3: Write `hooks/useAccountThemeSync.ts`**

```ts
import { useEffect } from "react";
import { reconcileThemePreference } from "@scripta/shared/themes";
import { fetchAccountTheme, isThemeSyncFailure, saveAccountTheme } from "../api/theme";
import { applyThemePreference, readThemePreference } from "../lib/theme";

async function syncOnce(): Promise<void> {
  const { apply, upload } = reconcileThemePreference(await fetchAccountTheme(), readThemePreference());
  if (apply) applyThemePreference(apply);
  if (upload) await saveAccountTheme(upload);
}

export function useAccountThemeSync(): void {
  useEffect(() => {
    function run() {
      syncOnce().catch((err: unknown) => {
        if (!isThemeSyncFailure(err)) throw err;
      });
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") run();
    }
    run();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
}
```

- [ ] **Step 4: Mount the sync in the signed-in shell**

In `frontend/src/layouts/DashboardLayout.tsx`, add `import { useAccountThemeSync } from "../hooks/useAccountThemeSync";` beside the other hook imports, and add `useAccountThemeSync();` on the line after `useGenreEnrichment(library?.data.books ?? [], updateLibrary);` inside `DashboardLayout()`.

- [ ] **Step 5: Rewrite the landing toggle on the shared registry**

In `frontend/src/components/landing/ThemeToggle.tsx`, keep `SunIcon` and `MoonIcon` exactly as they are; replace the imports, the `Theme` type, `readTheme`, and the `ThemeToggle` component with:

```tsx
import { resolveTheme, themes } from "@scripta/shared/themes";
import { applyThemePreference, osScheme, useThemePreference } from "../../lib/theme";
```

(at the top, replacing `import { useState } from "react";`, and delete `type Theme` and `readTheme`), and:

```tsx
export function ThemeToggle() {
  const scheme = themes[resolveTheme(useThemePreference(), osScheme())].scheme;

  return (
    <button
      type="button"
      onClick={() => applyThemePreference(scheme === "dark" ? "light" : "dark")}
      aria-label={scheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-(--color-border) text-(--color-text-dim) transition-colors hover:bg-(--color-surface-hover) hover:text-(--color-text)"
    >
      {scheme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
```

- [ ] **Step 6: Typecheck, lint, test**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: exit 0 / all PASS.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add frontend/src/lib/theme.ts frontend/src/api/theme.ts frontend/src/hooks/useAccountThemeSync.ts frontend/src/layouts/DashboardLayout.tsx frontend/src/components/landing/ThemeToggle.tsx && /usr/bin/git commit -m "Sync the web theme with the account and read schemes from the registry

The signed-in shell reconciles with GET /auth/theme on mount and when the
tab becomes visible; offline and server errors leave the theme alone.
The landing toggle now reads the active theme's scheme, so Midnight shows
the sun instead of assuming anything not \"dark\" is light.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/src/lib/theme.ts frontend/src/api/theme.ts frontend/src/hooks/useAccountThemeSync.ts frontend/src/layouts/DashboardLayout.tsx frontend/src/components/landing/ThemeToggle.tsx
```

---

### Task 6: Web Settings → Appearance picker

**Files:**
- Create: `frontend/src/components/ThemePicker.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx` (the `return (` block)

**Interfaces:**
- Consumes: `THEME_IDS`, `themes`, `type ThemeColors`, `type ThemePreference` (Task 1); `applyThemePreference`, `useThemePreference` (Task 5); `saveAccountTheme`, `isThemeSyncFailure` (Task 5).
- Produces: `ThemePicker` component.

- [ ] **Step 1: Write the picker**

Create `frontend/src/components/ThemePicker.tsx`:

```tsx
import { useState } from "react";
import { THEME_IDS, themes, type ThemeColors, type ThemePreference } from "@scripta/shared/themes";
import { isThemeSyncFailure, saveAccountTheme } from "../api/theme";
import { applyThemePreference, useThemePreference } from "../lib/theme";

const OPTIONS: ThemePreference[] = ["system", ...THEME_IDS];

function Swatch({ colors }: { colors: ThemeColors }) {
  return (
    <div className="flex flex-1 p-1.5" style={{ background: colors.background }}>
      <div className="flex flex-1 flex-col justify-between rounded p-1.5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: colors.text }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: colors.textDim }} />
        <div className="h-2.5 rounded" style={{ background: colors.accent }} />
      </div>
    </div>
  );
}

export function ThemePicker() {
  const selected = useThemePreference();
  const [error, setError] = useState<string | null>(null);

  async function choose(preference: ThemePreference) {
    applyThemePreference(preference);
    setError(null);
    try {
      await saveAccountTheme(preference);
    } catch (err) {
      if (!isThemeSyncFailure(err)) throw err;
      setError("Couldn't save to your account. Try again.");
    }
  }

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {OPTIONS.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name="theme"
              value={option}
              checked={selected === option}
              onChange={() => void choose(option)}
              className="peer sr-only"
            />
            <div className="flex h-16 overflow-hidden rounded-lg border border-(--color-border) peer-checked:ring-2 peer-checked:ring-(--color-accent) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--color-accent)">
              {option === "system" ? (
                <>
                  <Swatch colors={themes.light.colors} />
                  <Swatch colors={themes.dark.colors} />
                </>
              ) : (
                <Swatch colors={themes[option].colors} />
              )}
            </div>
            <span className="mt-1.5 block text-center text-xs">{option === "system" ? "System" : themes[option].label}</span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-(--color-danger)">
          {error}
        </p>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 2: Add the Appearance section**

In `frontend/src/pages/SettingsPage.tsx`, add `import { ThemePicker } from "../components/ThemePicker";` with the other component imports. In the returned JSX, directly after `<h2 className="mb-6 text-lg font-bold">Settings</h2>` insert:

```tsx
      <section className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
        <h3 className="mb-4 text-sm font-semibold">Appearance</h3>
        <ThemePicker />
      </section>
```

and change the Account section's opening tag from `<section className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">` to `<section className="mt-5 rounded-xl border border-(--color-border) bg-(--color-surface) p-5">` (the sections below it already use `mt-5`).

- [ ] **Step 3: Typecheck, lint, test**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: exit 0 / all PASS.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add frontend/src/components/ThemePicker.tsx frontend/src/pages/SettingsPage.tsx && /usr/bin/git commit -m "Add Settings > Appearance with a live-preview theme picker

Tiles are native radios painted from the registry, so keyboard and screen
readers work without extra code and no image assets are needed. A failed
save keeps the theme on this device and says so; the account still wins
on the next sync.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/src/components/ThemePicker.tsx frontend/src/pages/SettingsPage.tsx
```

---

### Task 7: Mobile ThemeProvider on the shared registry, with account sync

**Files:**
- Modify: `mobile/src/ui/theme.tsx` (whole file)
- Create: `mobile/src/features/settings/themeSync.ts`
- Modify: `mobile/src/app/(app)/_layout.tsx`

**Interfaces:**
- Consumes: `themes`, `parseThemePreference`, `resolveTheme`, `reconcileThemePreference`, types (Task 1); `GET`/`PUT /auth/theme` (Task 2); `apiClient`, `ApiError` from `mobile/src/core/api.ts`.
- Produces (used by Task 8 and every existing `useTheme()` caller):
  - `useTheme(): Theme` where `Theme = { id: ThemeId; mode: ThemeMode; colors: ThemeColors; preference: ThemePreference; setPreference: (preference: ThemePreference) => void }` — `mode` keeps meaning "light" | "dark", so `ThemedStatusBar`, `ReaderCardBlock` and `ReaderGlyph` are untouched.
  - `ThemeProvider({ children })` (the unused `mode` prop is removed).
  - `themeSync.ts`: `fetchAccountTheme(): Promise<ThemePreference | null>`, `saveAccountTheme(theme: ThemePreference): Promise<void>`, `isThemeSyncFailure(err: unknown): boolean`, `useAccountThemeSync(): void`.

Mobile tests run in plain Node and cannot render React Native; the logic is in Task 1. Verification here is typecheck, the existing test suite, and the Task 9 device pass.

- [ ] **Step 1: Replace `mobile/src/ui/theme.tsx`**

```tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Appearance, useColorScheme } from "react-native";
import {
  parseThemePreference,
  resolveTheme,
  themes,
  type ThemeColors,
  type ThemeId,
  type ThemePreference,
  type ThemeScheme,
} from "@scripta/shared/themes";

export type { ThemeColors };

export const spacing = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radii = { sm: 6, md: 8, lg: 12, xl: 16, full: 999 } as const;
export const typography = {
  caption: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 14, lineHeight: 20 },
  input: { fontSize: 16, lineHeight: 22 },
  title: { fontSize: 18, lineHeight: 24 },
  heading: { fontSize: 24, lineHeight: 30 },
} as const;
export const minimumTouchTarget = 44;
export const dynamicType = { allowFontScaling: true } as const;

export type ThemeMode = ThemeScheme;
export type Theme = {
  id: ThemeId;
  mode: ThemeMode;
  colors: ThemeColors;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const STORAGE_KEY = "theme";
const ThemeContext = createContext<Theme | undefined>(undefined);

function osScheme(scheme: ReturnType<typeof useColorScheme>): ThemeScheme {
  return scheme === "dark" ? "dark" : "light";
}

function applyNativeScheme(preference: ThemePreference): void {
  Appearance.setColorScheme(preference === "system" ? "unspecified" : themes[preference].scheme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(
      (stored) => {
        const parsed = parseThemePreference(stored);
        applyNativeScheme(parsed);
        setPreferenceState(parsed);
      },
      (err: unknown) => {
        console.warn("Couldn't read the saved theme; following the system.", err);
        setPreferenceState("system");
      },
    );
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    applyNativeScheme(next);
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch((err: unknown) => {
      console.warn("Couldn't save the theme on this device.", err);
    });
  }, []);

  const value = useMemo<Theme | null>(() => {
    if (!preference) return null;
    const id = resolveTheme(preference, osScheme(scheme));
    return { id, mode: themes[id].scheme, colors: themes[id].colors, preference, setPreference };
  }, [preference, scheme, setPreference]);

  if (!value) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  const scheme = useColorScheme();
  if (context) return context;
  const id = osScheme(scheme);
  return {
    id,
    mode: id,
    colors: themes[id].colors,
    preference: "system",
    setPreference: () => {
      throw new Error("setPreference needs a ThemeProvider above it.");
    },
  };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => subscription.remove();
  }, []);

  return reduced;
}
```

- [ ] **Step 2: Typecheck the provider change on its own**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile`
Expected: exit 0. If a caller imported `palettes` or passed `mode` to `ThemeProvider`, typecheck names it — none do today (`grep -rn 'palettes\|ThemeProvider mode' mobile/src` is empty apart from this file); fix any hit by reading `useTheme().colors`.

- [ ] **Step 3: Write `mobile/src/features/settings/themeSync.ts`**

```ts
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { parseThemePreference, reconcileThemePreference, type ThemePreference } from "@scripta/shared/themes";
import { ApiError, apiClient } from "../../core/api";
import { useTheme } from "../../ui/theme";

export async function fetchAccountTheme(): Promise<ThemePreference | null> {
  const body = await apiClient.request<{ theme: unknown }>("/auth/theme", { auth: true });
  return body.theme === null ? null : parseThemePreference(body.theme);
}

export async function saveAccountTheme(theme: ThemePreference): Promise<void> {
  await apiClient.request("/auth/theme", { method: "PUT", body: { theme }, auth: true });
}

export function isThemeSyncFailure(err: unknown): boolean {
  return err instanceof ApiError || err instanceof TypeError;
}

export function useAccountThemeSync(): void {
  const { preference, setPreference } = useTheme();
  const latest = useRef(preference);

  useEffect(() => {
    latest.current = preference;
  }, [preference]);

  useEffect(() => {
    async function syncOnce() {
      const { apply, upload } = reconcileThemePreference(await fetchAccountTheme(), latest.current);
      if (apply) setPreference(apply);
      if (upload) await saveAccountTheme(upload);
    }
    function run() {
      syncOnce().catch((err: unknown) => {
        if (!isThemeSyncFailure(err)) throw err;
      });
    }
    run();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => subscription.remove();
  }, [setPreference]);
}
```

- [ ] **Step 4: Mount the sync for signed-in users**

In `mobile/src/app/(app)/_layout.tsx`, add `import { useAccountThemeSync } from "../../features/settings/themeSync";` with the other feature imports, add below the `GenreEnrichment` component:

```tsx
function ThemeSync() {
  useAccountThemeSync();
  return null;
}
```

and render `<ThemeSync />` directly after `<GenreEnrichment />` inside the returned fragment (that fragment is only reached once `user` and `user.username` are set).

- [ ] **Step 5: Typecheck and test**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: exit 0; all existing tests PASS.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add mobile/src/ui/theme.tsx mobile/src/features/settings/themeSync.ts "mobile/src/app/(app)/_layout.tsx" && /usr/bin/git commit -m "Drive the mobile theme from the shared registry and the account

The provider reads the cached choice before its first render so there is
no flash of the wrong palette, and pins the native appearance to the
theme's scheme so alerts and the keyboard match Matrix or Oxblood. Sync
runs on sign-in and whenever the app returns to the foreground.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/ui/theme.tsx mobile/src/features/settings/themeSync.ts "mobile/src/app/(app)/_layout.tsx"
```

---

### Task 8: Mobile Settings → Appearance picker

**Files:**
- Create: `mobile/src/features/settings/ThemePicker.tsx`
- Modify: `mobile/src/features/settings/SettingsScreen.tsx` (first child of the `ScrollView`)

**Interfaces:**
- Consumes: `THEME_IDS`, `themes`, `type ThemeColors`, `type ThemePreference` (Task 1); `useTheme`, `spacing`, `radii`, `typography`, `dynamicType`, `minimumTouchTarget` (Task 7's `ui/theme.tsx`); `saveAccountTheme`, `isThemeSyncFailure` (Task 7).
- Produces: `ThemePicker` component.

- [ ] **Step 1: Write the picker**

Create `mobile/src/features/settings/ThemePicker.tsx`:

```tsx
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { THEME_IDS, themes, type ThemeColors, type ThemePreference } from "@scripta/shared/themes";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { isThemeSyncFailure, saveAccountTheme } from "./themeSync";

const OPTIONS: ThemePreference[] = ["system", ...THEME_IDS];

function Swatch({ colors }: { colors: ThemeColors }) {
  return (
    <View style={[styles.swatch, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.line, { width: "75%", backgroundColor: colors.text }]} />
        <View style={[styles.line, { width: "50%", backgroundColor: colors.textDim }]} />
        <View style={[styles.bar, { backgroundColor: colors.accent }]} />
      </View>
    </View>
  );
}

export function ThemePicker() {
  const { colors, preference, setPreference } = useTheme();
  const [error, setError] = useState<string | null>(null);

  function choose(next: ThemePreference) {
    setPreference(next);
    setError(null);
    saveAccountTheme(next).catch((err: unknown) => {
      if (!isThemeSyncFailure(err)) throw err;
      setError("Couldn't save to your account. Try again.");
    });
  }

  return (
    <View style={styles.wrap}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={styles.grid}>
        {OPTIONS.map((option) => {
          const checked = option === preference;
          const label = option === "system" ? "System" : themes[option].label;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={label}
              onPress={() => choose(option)}
              style={styles.tile}
            >
              <View style={[styles.preview, { borderColor: checked ? colors.accent : colors.border }]}>
                {option === "system" ? (
                  <>
                    <Swatch colors={themes.light.colors} />
                    <Swatch colors={themes.dark.colors} />
                  </>
                ) : (
                  <Swatch colors={themes[option].colors} />
                )}
              </View>
              <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.label, { color: checked ? colors.text : colors.textDim }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text accessibilityRole="alert" {...dynamicType} style={[typography.caption, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { width: "30%", flexGrow: 1, minHeight: minimumTouchTarget, gap: spacing.xs },
  preview: { height: 64, flexDirection: "row", borderRadius: radii.md, borderWidth: 2, overflow: "hidden" },
  swatch: { flex: 1, padding: spacing.xs },
  card: { flex: 1, borderWidth: 1, borderRadius: radii.sm, padding: spacing.xs, justifyContent: "space-between" },
  line: { height: 4, borderRadius: radii.full },
  bar: { height: 8, borderRadius: radii.sm },
  label: { textAlign: "center" },
});
```

- [ ] **Step 2: Add the Appearance section**

In `mobile/src/features/settings/SettingsScreen.tsx`, add `import { ThemePicker } from "./ThemePicker";` with the other imports. Inside the `ScrollView`, insert before the existing Account section (`<View style={[styles.section, ...]}>` whose heading is `Account`):

```tsx
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.heading, { color: colors.text }]}>Appearance</Text>
        <ThemePicker />
      </View>
```

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: exit 0; all PASS.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add mobile/src/features/settings/ThemePicker.tsx mobile/src/features/settings/SettingsScreen.tsx && /usr/bin/git commit -m "Add Settings > Appearance to the mobile app

Same live previews as the web picker, three to a row, each tile a radio
with its checked state exposed to screen readers. A failed save keeps
the theme on this device and says so.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/features/settings/ThemePicker.tsx mobile/src/features/settings/SettingsScreen.tsx
```

---

### Task 9: Whole-branch verification (controller)

Run by the main session after the final review, not by an implementer subagent.

- [ ] **Step 1: Full automated pass**

Run each, in order, from the worktree root:

```bash
npm run build --workspace @scripta/shared
```
```bash
npm test --workspace @scripta/shared
```
```bash
npm run typecheck --workspace backend && npm test --workspace backend
```
```bash
npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
```
```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```
```bash
npm run check:agents
```

Expected: all exit 0.

- [ ] **Step 2: Browser pass (web)**

Start the stack per `docs/dev-workflow.md` (claimed port slot, fixture account — never ask the user for a password) and use the in-app browser:

1. Settings → Appearance lists System + 11 tiles; pick Midnight → page turns navy, reader-card plates switch to the reversed print, primary buttons have dark text on brass.
2. Pick Sepia → light scheme, plates switch back to paper.
3. Reload → Sepia persists; `GET /auth/theme` in the network panel returns `{"theme":"sepia"}`.
4. Set `localStorage.theme = "vaporwave"` in the console and reload → Light, no console error; Settings shows System selected (Review Focus 1).
5. Go offline in devtools, switch tabs away and back → no error UI, no uncaught rejection in the console (Review Focus 2).
6. Stop the backend, pick Forest → Forest applies and the alert "Couldn't save to your account. Try again." appears; restart the backend, switch tabs away and back → the account's previous theme (Sepia) returns (Review Focus 3).
7. With Midnight active, open `/` → the landing toggle shows the sun; click → Light (Review Focus 5).
8. Spot-check Matrix and Synthwave primary buttons and the danger confirm dialog for readable text (Review Focus 4).

- [ ] **Step 3: Device pass (mobile, optional)**

Run: `node scripts/dev-status.mjs --json`
If another worktree holds the emulator lease, skip and report the skip. Otherwise, with the seeded dev account: pick Oxblood in Settings → Appearance → status bar icons light, a native `Alert` (Sign out) renders dark; kill and reopen the app → Oxblood with no flash of Light; pick System → follows the emulator's dark-mode toggle.

- [ ] **Step 4: Report**

Report each step's outcome, including anything skipped and why.
