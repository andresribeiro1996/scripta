# App Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two font slots — display (headings) and text (everything else) — that default per theme, can each be overridden, and sync through the account with the theme, on web and mobile.

**Architecture:** A font catalog joins the theme registry in `@scripta/shared/themes`, with per-theme defaults and an `Appearance` preference (`theme`, `displayFont`, `textFont`) reconciled per field. The backend replaces `/auth/theme` with `/auth/appearance` (two new nullable columns). Web gets the fonts through the generated `themes.css` (font faces, per-theme font variables, override blocks keyed by `data-font-*` attributes); mobile bundles the same fonts, loads them with `expo-font`, and routes every `Text` through a shared component that applies the resolved font.

**Tech Stack:** TypeScript, `node:test`, Fastify + zod 3 + `node:sqlite`, React 19 + Vite + Tailwind v4, Expo 57 / React Native 0.86 + `expo-font` + `expo-splash-screen` + AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-09-28-app-typography-design.md`

## Global Constraints

- Font ids, labels, CSS family names, slots, weights and scales are exactly those in Task 1's `fonts.ts`; theme defaults exactly those in Task 1's table.
- Local storage keys: `theme` (unchanged), `fontDisplay`, `fontText` (web `localStorage`, mobile AsyncStorage). Web `<html>` attributes: `data-font-display`, `data-font-text` (set via `dataset.fontDisplay` / `dataset.fontText`).
- Account API: `GET`/`PUT /auth/appearance`, body keys `theme`, `displayFont`, `textFont`; DB columns `display_font`, `text_font`. `/auth/theme` is removed.
- Font file names: `<id>-<weight>` — web `frontend/public/fonts/<id>-<weight>.woff2`, mobile `mobile/assets/fonts/<id>-<weight>.ttf`; OFL texts at `frontend/public/fonts/licenses/<id>.txt` and `mobile/assets/fonts/licenses/<id>.txt`.
- Font files come only from Google Fonts (`fonts.googleapis.com` CSS2 API → `fonts.gstatic.com`) and licences only from `raw.githubusercontent.com/google/fonts/main/ofl/<dir>/OFL.txt`. The user approved this download.
- Copy, exactly: picker group labels `Headings` and `Text`; first chip `Theme default · <font label>`; save failure `Couldn't save to your account. Try again.`
- Sync/save failures: catch only `ApiError` and `TypeError`; let anything else propagate.
- No comments in code (AGENTS.md), except the existing generated-file header in `themes.css`.
- Consumers read `@scripta/shared` from `dist/`: run `npm run build --workspace @scripta/shared` before any consumer typecheck/test.
- Git: `/usr/bin/git`, stage and commit in one command with explicit paths, end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verify per package from the worktree root: shared `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`; backend `npm run typecheck --workspace backend && npm test --workspace backend`; web `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`; mobile `npm run typecheck --workspace mobile && npm test --workspace mobile`.
- Refinements over the spec (recorded in the spec by this plan's commit): mobile uses the display font for any `Text` whose font size is ≥ 18 unless a `display` prop says otherwise; `TextInput` is not wrapped — its single render site (`ui/components.tsx` `Input`) applies the text font; `FontDefinition` carries a CSS `family` separate from its `label`; a mobile font-load failure resolves both slots to System.

## Review Focus

1. A stored font id that is unknown, or not allowed in its slot (a removed font, a hand-edited `fontText: "vt323"`), must fall back to the theme default on both clients without errors — pinned by `parseFontPreference`/`resolveFonts` tests (Task 1) and a web boot check in Task 10.
2. Changing theme must move "Theme default" fonts to the new theme's pair while an explicit override stays put — pinned by `resolveFonts` tests (Task 1) and a manual check in Task 10.
3. If the bundled fonts fail to load on mobile, the app must still start, on System fonts, with no red-box for an unknown family — pinned by the provider's `bundledFonts` path (Task 7) and `fontStyleFor(system)` returning nothing (Task 7 test).
4. Text that sets its own `fontFamily` (book-card and mural styles) must never be overridden by the themed font — pinned by the `fontStyleFor` explicit-family test (Task 7) and a manual card check in Task 10.
5. Novelty fonts (Press Start 2P, Monoton, VT323) in tight UI — header titles, tab labels, chips — must stay legible and not overflow — manual check in Task 10 with a Press Start 2P override.

---

### Task 1: Shared font catalog, theme defaults and appearance preferences

**Files:**
- Create: `packages/shared/src/themes/fonts.ts`
- Modify: `packages/shared/src/themes/palettes.ts` (`ThemeDefinition` + one `fonts` line per theme)
- Modify: `packages/shared/src/themes/preference.ts`
- Modify: `packages/shared/src/themes/index.ts`
- Test: `packages/shared/src/themes/fonts.test.ts` (new)

**Interfaces:**
- Produces (from `@scripta/shared/themes`): `FontSlot`, `FontWeight`, `FontDefinition`, `FONT_IDS`, `FontId`, `fonts`, `DISPLAY_FONT_IDS`, `TEXT_FONT_IDS`, `fontStack(id)`, `fontFileName(id, weight)`; `ThemeDefinition.fonts: { display: FontId; text: FontId }`; `FontPreference`, `DISPLAY_FONT_PREFERENCES`, `TEXT_FONT_PREFERENCES`, `Appearance`, `AccountAppearance`, `parseFontPreference(slot, value)`, `parseAccountAppearance(value)`, `resolveFonts(themeId, displayFont, textFont)`, `reconcileAppearance(account, device)`. `reconcileThemePreference` stays until Task 7 removes it.

- [ ] **Step 1: Write the failing test** — create `packages/shared/src/themes/fonts.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DISPLAY_FONT_IDS, FONT_IDS, TEXT_FONT_IDS, fontFileName, fontStack, fonts, type FontId } from "./fonts.js";
import { THEME_IDS, themes } from "./palettes.js";
import {
  DISPLAY_FONT_PREFERENCES,
  TEXT_FONT_PREFERENCES,
  parseAccountAppearance,
  parseFontPreference,
  reconcileAppearance,
  resolveFonts,
  type FontPreference,
} from "./preference.js";

test("the catalog lists every font once and FONT_IDS matches its keys", () => {
  assert.deepEqual([...FONT_IDS].sort(), Object.keys(fonts).sort());
  assert.equal(new Set(FONT_IDS).size, FONT_IDS.length);
});

test("picker lists are in the designed order and only hold fonts allowed in that slot", () => {
  assert.deepEqual(DISPLAY_FONT_IDS, ["system", "playfair", "literata", "fraunces", "cormorant", "specialElite", "vt323", "orbitron", "righteous", "pressStart", "monoton"]);
  assert.deepEqual(TEXT_FONT_IDS, ["system", "literata", "atkinson", "jetbrainsMono"]);
  for (const id of DISPLAY_FONT_IDS) assert.ok(fonts[id].slots.includes("display"), id);
  for (const id of TEXT_FONT_IDS) assert.ok(fonts[id].slots.includes("text"), id);
});

test("system has no files; every other font has a family, and display-only fonts ship exactly one weight", () => {
  assert.equal(fonts.system.family, null);
  assert.deepEqual(fonts.system.weights, []);
  for (const id of FONT_IDS.filter((font) => font !== "system")) {
    assert.ok(fonts[id].family, id);
    assert.ok(fonts[id].weights.length >= 1, id);
    if (!fonts[id].slots.includes("text")) assert.equal(fonts[id].weights.length, 1, id);
  }
});

test("every theme's default fonts exist and are allowed in their slot", () => {
  const expected: Record<string, [FontId, FontId]> = {
    light: ["playfair", "system"], dark: ["playfair", "system"], midnight: ["playfair", "system"],
    sepia: ["literata", "literata"], rose: ["fraunces", "system"], forest: ["fraunces", "system"],
    matrix: ["vt323", "jetbrainsMono"], synthwave: ["orbitron", "system"], seventies: ["righteous", "system"],
    newsprint: ["specialElite", "literata"], oxblood: ["cormorant", "literata"],
  };
  for (const id of THEME_IDS) {
    assert.deepEqual([themes[id].fonts.display, themes[id].fonts.text], expected[id], id);
    assert.ok(fonts[themes[id].fonts.display].slots.includes("display"), id);
    assert.ok(fonts[themes[id].fonts.text].slots.includes("text"), id);
  }
});

test("Press Start 2P and Monoton are override-only", () => {
  for (const id of THEME_IDS) {
    assert.notEqual(themes[id].fonts.display, "pressStart");
    assert.notEqual(themes[id].fonts.display, "monoton");
  }
});

test("fontStack puts the quoted family first; fontFileName joins id and weight", () => {
  assert.equal(fontStack("playfair"), '"Playfair Display", ui-serif, Georgia, serif');
  assert.equal(fontStack("system"), '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
  assert.equal(fontFileName("jetbrainsMono", 700), "jetbrainsMono-700");
});

test("parseFontPreference keeps allowed values per slot and turns anything else into theme", () => {
  for (const value of DISPLAY_FONT_PREFERENCES) assert.equal(parseFontPreference("display", value), value);
  for (const value of TEXT_FONT_PREFERENCES) assert.equal(parseFontPreference("text", value), value);
  assert.equal(parseFontPreference("text", "vt323"), "theme");
  assert.equal(parseFontPreference("display", "atkinson"), "theme");
  for (const value of ["comic", "", null, undefined, 7, {}]) assert.equal(parseFontPreference("display", value), "theme");
});

test("parseAccountAppearance keeps null as never-chosen and normalises unknown values", () => {
  assert.deepEqual(parseAccountAppearance({ theme: null, displayFont: null, textFont: null }), { theme: null, displayFont: null, textFont: null });
  assert.deepEqual(parseAccountAppearance({}), { theme: null, displayFont: null, textFont: null });
  assert.deepEqual(parseAccountAppearance(null), { theme: null, displayFont: null, textFont: null });
  assert.deepEqual(parseAccountAppearance({ theme: "vaporwave", displayFont: "comic", textFont: "vt323" }), { theme: "system", displayFont: "theme", textFont: "theme" });
  assert.deepEqual(parseAccountAppearance({ theme: "matrix", displayFont: "monoton", textFont: "atkinson" }), { theme: "matrix", displayFont: "monoton", textFont: "atkinson" });
});

test("resolveFonts uses the theme default for theme, keeps an allowed override, and ignores an ineligible one", () => {
  assert.deepEqual(resolveFonts("matrix", "theme", "theme"), { display: "vt323", text: "jetbrainsMono" });
  assert.deepEqual(resolveFonts("sepia", "pressStart", "atkinson"), { display: "pressStart", text: "atkinson" });
  assert.deepEqual(resolveFonts("light", "theme", "vt323" as FontPreference), { display: "playfair", text: "system" });
  assert.deepEqual(resolveFonts("oxblood", "atkinson" as FontPreference, "theme"), { display: "cormorant", text: "literata" });
});

test("reconcileAppearance applies the rule per field", () => {
  const device = { theme: "sepia", displayFont: "theme", textFont: "atkinson" } as const;
  assert.deepEqual(reconcileAppearance({ theme: null, displayFont: null, textFont: null }, device), { apply: {}, upload: device });
  assert.deepEqual(reconcileAppearance({ theme: "sepia", displayFont: "theme", textFont: "atkinson" }, device), { apply: {}, upload: {} });
  assert.deepEqual(reconcileAppearance({ theme: "matrix", displayFont: null, textFont: "atkinson" }, device), { apply: { theme: "matrix" }, upload: { displayFont: "theme" } });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL — `Cannot find module '.../themes/fonts.js'`.

- [ ] **Step 3: Create `packages/shared/src/themes/fonts.ts`**

```ts
export type FontSlot = "display" | "text";
export type FontWeight = 400 | 600 | 700;

export interface FontDefinition {
  label: string;
  family: string | null;
  slots: readonly FontSlot[];
  weights: readonly FontWeight[];
  scale: number;
  fallback: string;
}

const SYSTEM_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const SERIF = "ui-serif, Georgia, serif";
const MONO = "ui-monospace, monospace";
const SANS = "sans-serif";

export const FONT_IDS = ["system", "playfair", "literata", "fraunces", "cormorant", "specialElite", "vt323", "orbitron", "righteous", "pressStart", "monoton", "atkinson", "jetbrainsMono"] as const;

export type FontId = (typeof FONT_IDS)[number];

export const fonts: Record<FontId, FontDefinition> = {
  system: { label: "System", family: null, slots: ["display", "text"], weights: [], scale: 1, fallback: SYSTEM_STACK },
  playfair: { label: "Playfair", family: "Playfair Display", slots: ["display"], weights: [700], scale: 1, fallback: SERIF },
  literata: { label: "Literata", family: "Literata", slots: ["display", "text"], weights: [400, 700], scale: 1, fallback: SERIF },
  fraunces: { label: "Fraunces", family: "Fraunces", slots: ["display"], weights: [700], scale: 1, fallback: SERIF },
  cormorant: { label: "Cormorant Garamond", family: "Cormorant Garamond", slots: ["display"], weights: [600], scale: 1.12, fallback: SERIF },
  specialElite: { label: "Special Elite", family: "Special Elite", slots: ["display"], weights: [400], scale: 1, fallback: MONO },
  vt323: { label: "VT323", family: "VT323", slots: ["display"], weights: [400], scale: 1.3, fallback: MONO },
  orbitron: { label: "Orbitron", family: "Orbitron", slots: ["display"], weights: [700], scale: 0.88, fallback: SANS },
  righteous: { label: "Righteous", family: "Righteous", slots: ["display"], weights: [400], scale: 1, fallback: SANS },
  pressStart: { label: "Press Start 2P", family: "Press Start 2P", slots: ["display"], weights: [400], scale: 0.72, fallback: MONO },
  monoton: { label: "Monoton", family: "Monoton", slots: ["display"], weights: [400], scale: 0.85, fallback: SANS },
  atkinson: { label: "Atkinson Hyperlegible", family: "Atkinson Hyperlegible", slots: ["text"], weights: [400, 700], scale: 1, fallback: SANS },
  jetbrainsMono: { label: "JetBrains Mono", family: "JetBrains Mono", slots: ["text"], weights: [400, 700], scale: 1, fallback: MONO },
};

export const DISPLAY_FONT_IDS = ["system", "playfair", "literata", "fraunces", "cormorant", "specialElite", "vt323", "orbitron", "righteous", "pressStart", "monoton"] as const satisfies readonly FontId[];

export const TEXT_FONT_IDS = ["system", "literata", "atkinson", "jetbrainsMono"] as const satisfies readonly FontId[];

export function fontStack(id: FontId): string {
  const font = fonts[id];
  return font.family ? `"${font.family}", ${font.fallback}` : font.fallback;
}

export function fontFileName(id: FontId, weight: FontWeight): string {
  return `${id}-${weight}`;
}
```

- [ ] **Step 4: Give every theme its fonts** — in `packages/shared/src/themes/palettes.ts`:
  - add `import type { FontId } from "./fonts.js";` as the first line;
  - add `fonts: { display: FontId; text: FontId };` to `interface ThemeDefinition` after `scheme: ThemeScheme;`;
  - in each theme entry, directly after its `scheme: "…",` line, add its `fonts` line:
    - `light`, `dark`, `midnight`: `fonts: { display: "playfair", text: "system" },`
    - `sepia`: `fonts: { display: "literata", text: "literata" },`
    - `rose`, `forest`: `fonts: { display: "fraunces", text: "system" },`
    - `matrix`: `fonts: { display: "vt323", text: "jetbrainsMono" },`
    - `synthwave`: `fonts: { display: "orbitron", text: "system" },`
    - `seventies`: `fonts: { display: "righteous", text: "system" },`
    - `newsprint`: `fonts: { display: "specialElite", text: "literata" },`
    - `oxblood`: `fonts: { display: "cormorant", text: "literata" },`

- [ ] **Step 5: Add the appearance preferences** — append to `packages/shared/src/themes/preference.ts` (keep everything already there; change its first import to also bring in `themes`):

```ts
import { THEME_IDS, themes, type ThemeId, type ThemeScheme } from "./palettes.js";
import { DISPLAY_FONT_IDS, TEXT_FONT_IDS, fonts, type FontId, type FontSlot } from "./fonts.js";
```

```ts
export type FontPreference = FontId | "theme";

export const DISPLAY_FONT_PREFERENCES = ["theme", ...DISPLAY_FONT_IDS] as const;

export const TEXT_FONT_PREFERENCES = ["theme", ...TEXT_FONT_IDS] as const;

export interface Appearance {
  theme: ThemePreference;
  displayFont: FontPreference;
  textFont: FontPreference;
}

export type AccountAppearance = { [K in keyof Appearance]: Appearance[K] | null };

export function parseFontPreference(slot: FontSlot, value: unknown): FontPreference {
  const allowed: readonly string[] = slot === "display" ? DISPLAY_FONT_PREFERENCES : TEXT_FONT_PREFERENCES;
  return typeof value === "string" && allowed.includes(value) ? (value as FontPreference) : "theme";
}

function nullable<T>(value: unknown, parse: (raw: unknown) => T): T | null {
  return value === null || value === undefined ? null : parse(value);
}

export function parseAccountAppearance(value: unknown): AccountAppearance {
  const body = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    theme: nullable(body.theme, parseThemePreference),
    displayFont: nullable(body.displayFont, (raw) => parseFontPreference("display", raw)),
    textFont: nullable(body.textFont, (raw) => parseFontPreference("text", raw)),
  };
}

export function resolveFonts(themeId: ThemeId, displayFont: FontPreference, textFont: FontPreference): { display: FontId; text: FontId } {
  const pick = (slot: FontSlot, preference: FontPreference): FontId =>
    preference !== "theme" && fonts[preference].slots.includes(slot) ? preference : themes[themeId].fonts[slot];
  return { display: pick("display", displayFont), text: pick("text", textFont) };
}

function reconcileField<K extends keyof Appearance>(key: K, account: AccountAppearance, device: Appearance, apply: Partial<Appearance>, upload: Partial<Appearance>): void {
  const value = account[key];
  if (value === null) upload[key] = device[key];
  else if (value !== device[key]) apply[key] = value as Appearance[K];
}

export function reconcileAppearance(account: AccountAppearance, device: Appearance): { apply: Partial<Appearance>; upload: Partial<Appearance> } {
  const apply: Partial<Appearance> = {};
  const upload: Partial<Appearance> = {};
  reconcileField("theme", account, device, apply, upload);
  reconcileField("displayFont", account, device, apply, upload);
  reconcileField("textFont", account, device, apply, upload);
  return { apply, upload };
}
```

In `packages/shared/src/themes/index.ts` add `export * from "./fonts.js";`.

- [ ] **Step 6: Run tests and build**

Run: `npm test --workspace @scripta/shared && npm run build --workspace @scripta/shared`
Expected: all PASS (the existing theme tests plus the 10 new ones); build exits 0.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add packages/shared/src/themes && /usr/bin/git commit -m "Add the font catalog, per-theme font defaults and appearance preferences

Display and text slots each resolve to the theme's default unless the
user picked an allowed font; the account/device rule now runs per field
so fonts and theme sync independently through one setting.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- packages/shared/src/themes
```

---

### Task 2: Backend `/auth/appearance`

**Files:**
- Modify: `backend/src/modules/auth/domain/types.ts` (`UserRow`), `domain/ports.ts` (`setTheme` → `setAppearance`), `adapters/sqlite/schema.sql`, `adapters/sqlite/connection.ts`, `adapters/sqlite/sqliteAuthRepository.ts`, `service.ts`, `routes.ts`
- Test: `backend/src/modules/auth/routes.test.ts`, `service.test.ts`, `adapters/sqlite/sqliteAuthRepository.test.ts` (existing files, already in the `test` list)

**Interfaces:**
- Consumes: `THEME_PREFERENCES`, `DISPLAY_FONT_PREFERENCES`, `TEXT_FONT_PREFERENCES`, `parseAccountAppearance`, `type AccountAppearance`, `type Appearance` (Task 1).
- Produces: `GET /auth/appearance` → `200 { theme, displayFont, textFont }` (each nullable); `PUT /auth/appearance` partial body → `204`, else `400 { error: "Unknown appearance." }`; both `authGuard` + own `rateLimit { max: 120, timeWindow: "1 minute" }`. `/auth/theme` removed.

- [ ] **Step 1: Replace the repository tests** — in `adapters/sqlite/sqliteAuthRepository.test.ts`, replace the two theme tests (`"a fresh database has the theme column"` and `"migrating a database without the theme column …"`) with:

```ts
test("a fresh database has the appearance columns", () => {
  const cols = columnNames(freshDb(), "users");
  for (const column of ["theme", "display_font", "text_font"]) assert.ok(cols.includes(column), column);
});

test("migrating a database without the appearance columns adds them, NULL for existing users, and setAppearance updates only the given ones", () => {
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

  const cols = columnNames(db, "users");
  for (const column of ["theme", "display_font", "text_font"]) assert.ok(cols.includes(column), column);
  const repo = createSqliteAuthRepository(db);
  const row = () => repo.findUserById("u1");
  assert.deepEqual([row()?.theme, row()?.display_font, row()?.text_font], [null, null, null]);
  repo.setAppearance("u1", { theme: "midnight" });
  assert.deepEqual([row()?.theme, row()?.display_font, row()?.text_font], ["midnight", null, null]);
  repo.setAppearance("u1", { display_font: "vt323", text_font: "atkinson" });
  assert.deepEqual([row()?.theme, row()?.display_font, row()?.text_font], ["midnight", "vt323", "atkinson"]);
  repo.setAppearance("u1", {});
  assert.deepEqual([row()?.theme, row()?.display_font, row()?.text_font], ["midnight", "vt323", "atkinson"]);
});
```

- [ ] **Step 2: Replace the service tests** — in `service.test.ts`, replace the fake repo's `setTheme(userId, theme) { … }` method with:

```ts
    setAppearance(userId, fields) {
      const row = rows.get(userId);
      if (!row) return;
      rows.set(userId, {
        ...row,
        theme: fields.theme ?? row.theme,
        display_font: fields.display_font ?? row.display_font,
        text_font: fields.text_font ?? row.text_font,
      });
    },
```

and replace the three `getTheme …` tests with:

```ts
test("getAppearance is all null until something is saved, and setAppearance updates only the given fields", () => {
  const { service, repo } = makeService();
  const row = repo.createUser({ email: "t@example.test", username: "themer", passwordHash: null, googleId: null });
  assert.deepEqual(service.getAppearance(row.id), { theme: null, displayFont: null, textFont: null });
  service.setAppearance(row.id, { theme: "oxblood" });
  assert.deepEqual(service.getAppearance(row.id), { theme: "oxblood", displayFont: null, textFont: null });
  service.setAppearance(row.id, { displayFont: "monoton", textFont: "theme" });
  assert.deepEqual(service.getAppearance(row.id), { theme: "oxblood", displayFont: "monoton", textFont: "theme" });
});

test("getAppearance reads stored values this server no longer knows as the defaults", () => {
  const { service, repo } = makeService();
  const row = repo.createUser({ email: "old@example.test", username: "oldtheme", passwordHash: null, googleId: null });
  repo.rows.set(row.id, { ...row, theme: "vaporwave", display_font: "comic", text_font: "vt323" });
  assert.deepEqual(service.getAppearance(row.id), { theme: "system", displayFont: "theme", textFont: "theme" });
});

test("getAppearance is all null for an unknown user", () => {
  const { service } = makeService();
  assert.deepEqual(service.getAppearance("nobody"), { theme: null, displayFont: null, textFont: null });
});
```

- [ ] **Step 3: Replace the route tests** — in `routes.test.ts`, change `import type { ThemePreference } from "@scripta/shared/themes";` to `import type { AccountAppearance, Appearance } from "@scripta/shared/themes";`, then replace everything from `function themeService(` through the end of the `"theme routes carry their own rate limit …"` test with:

```ts
function appearanceService(stored: Map<string, AccountAppearance>): AuthService {
  const empty: AccountAppearance = { theme: null, displayFont: null, textFont: null };
  return {
    getAppearance: (userId: string) => stored.get(userId) ?? empty,
    setAppearance: (userId: string, patch: Partial<Appearance>) => {
      stored.set(userId, { ...(stored.get(userId) ?? empty), ...patch });
    },
    getUserById: (userId: string) => (userId === user.id ? user : null),
  } as unknown as AuthService;
}

async function callAppearanceRoute(service: AuthService, options: InjectOptions, token?: string) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (candidate: string) => (candidate === "valid-token" ? user : null));
  await app.register(buildAuthRoutes(service));
  const res = await app.inject(token ? { ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } } : options);
  await app.close();
  return { status: res.statusCode, body: res.body ? (res.json() as Record<string, unknown>) : null };
}

test("appearance routes reject a request without a valid access token", async () => {
  const service = appearanceService(new Map());
  assert.equal((await callAppearanceRoute(service, { method: "GET", url: "/auth/appearance" })).status, 401);
  assert.equal((await callAppearanceRoute(service, { method: "PUT", url: "/auth/appearance", payload: { theme: "dark" } })).status, 401);
  assert.equal((await callAppearanceRoute(service, { method: "GET", url: "/auth/appearance" }, "forged")).status, 401);
});

test("GET /auth/appearance is all null for an account that never chose anything", async () => {
  const { status, body } = await callAppearanceRoute(appearanceService(new Map()), { method: "GET", url: "/auth/appearance" }, "valid-token");
  assert.equal(status, 200);
  assert.deepEqual(body, { theme: null, displayFont: null, textFont: null });
});

test("a partial PUT round-trips one field without touching the others", async () => {
  const stored = new Map<string, AccountAppearance>();
  const service = appearanceService(stored);
  assert.equal((await callAppearanceRoute(service, { method: "PUT", url: "/auth/appearance", payload: { theme: "matrix" } }, "valid-token")).status, 204);
  assert.equal((await callAppearanceRoute(service, { method: "PUT", url: "/auth/appearance", payload: { displayFont: "pressStart" } }, "valid-token")).status, 204);
  const { body } = await callAppearanceRoute(service, { method: "GET", url: "/auth/appearance" }, "valid-token");
  assert.deepEqual(body, { theme: "matrix", displayFont: "pressStart", textFont: null });
});

test("PUT /auth/appearance rejects empty, unknown and slot-ineligible values", async () => {
  const stored = new Map<string, AccountAppearance>();
  const service = appearanceService(stored);
  for (const payload of [{}, { theme: "vaporwave" }, { displayFont: "atkinson" }, { textFont: "vt323" }, { textFont: null }, { theme: "dark", extra: 1 }, { font: "system" }]) {
    const { status, body } = await callAppearanceRoute(service, { method: "PUT", url: "/auth/appearance", payload }, "valid-token");
    assert.equal(status, 400, JSON.stringify(payload));
    assert.deepEqual(body, { error: "Unknown appearance." });
  }
  assert.equal(stored.size, 0);
});

test("the old /auth/theme routes are gone", async () => {
  const service = appearanceService(new Map());
  assert.equal((await callAppearanceRoute(service, { method: "GET", url: "/auth/theme" }, "valid-token")).status, 404);
});

test("appearance routes carry their own rate limit, separate from the shared auth limit", async () => {
  const service = appearanceService(new Map());
  const app = Fastify();
  await app.register(fastifyRateLimit, { max: 2, timeWindow: "1 minute" });
  app.decorate("authenticateAccessToken", (candidate: string) => (candidate === "valid-token" ? user : null));
  await app.register(buildAuthRoutes(service));

  const headers = { authorization: "Bearer valid-token" };
  for (let i = 0; i < 5; i++) {
    assert.equal((await app.inject({ method: "GET", url: "/auth/appearance", headers })).statusCode, 200, `GET #${i}`);
    assert.equal((await app.inject({ method: "PUT", url: "/auth/appearance", payload: { textFont: "atkinson" }, headers })).statusCode, 204, `PUT #${i}`);
  }
  assert.equal((await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode, 429);
  await app.close();
});
```

(`fastifyRateLimit` is already imported in this file by the existing rate-limit test; keep that import.)

- [ ] **Step 4: Run to see failures**

Run: `npm run build --workspace @scripta/shared && npm test --workspace backend`
Expected: FAIL — `repo.setAppearance is not a function`, `service.getAppearance is not a function`, 404s.

- [ ] **Step 5: Implement storage**
  - `domain/types.ts` `UserRow`: after `theme?: string | null;` add `display_font?: string | null;` and `text_font?: string | null;`.
  - `domain/ports.ts`: replace `setTheme(userId: string, theme: string): void;` with `setAppearance(userId: string, fields: { theme?: string; display_font?: string; text_font?: string }): void;`.
  - `adapters/sqlite/schema.sql`: after the `theme         TEXT,` line add `  display_font  TEXT,` and `  text_font     TEXT,`.
  - `adapters/sqlite/connection.ts`: after the `theme` ALTER line add
    `    if (!columns.some((column) => column.name === "display_font")) db.exec("ALTER TABLE users ADD COLUMN display_font TEXT");` and
    `    if (!columns.some((column) => column.name === "text_font")) db.exec("ALTER TABLE users ADD COLUMN text_font TEXT");`.
  - `adapters/sqlite/sqliteAuthRepository.ts`: delete `const setThemeStmt = …` and replace the `setTheme(userId, theme) { … },` method with:

```ts
    setAppearance(userId, fields) {
      const columns = (["theme", "display_font", "text_font"] as const).filter((column) => fields[column] !== undefined);
      if (columns.length === 0) return;
      db.prepare(`UPDATE users SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`).run(...columns.map((column) => fields[column] as string), userId);
    },
```

- [ ] **Step 6: Implement the service** — in `service.ts` change the themes import to `import { parseAccountAppearance, type AccountAppearance, type Appearance } from "@scripta/shared/themes";`, replace the two interface lines `getTheme…`/`setTheme…` with:

```ts
  getAppearance(userId: string): AccountAppearance;
  setAppearance(userId: string, patch: Partial<Appearance>): void;
```

and replace the `getTheme` / `setTheme` methods with:

```ts
    getAppearance(userId) {
      const row = repo.findUserById(userId);
      return parseAccountAppearance({ theme: row?.theme ?? null, displayFont: row?.display_font ?? null, textFont: row?.text_font ?? null });
    },

    setAppearance(userId, patch) {
      repo.setAppearance(userId, { theme: patch.theme, display_font: patch.displayFont, text_font: patch.textFont });
    },
```

- [ ] **Step 7: Implement the routes** — in `routes.ts` change the themes import to `import { DISPLAY_FONT_PREFERENCES, TEXT_FONT_PREFERENCES, THEME_PREFERENCES } from "@scripta/shared/themes";`, replace `const setThemeSchema = …` with:

```ts
const setAppearanceSchema = z
  .object({ theme: z.enum(THEME_PREFERENCES), displayFont: z.enum(DISPLAY_FONT_PREFERENCES), textFont: z.enum(TEXT_FONT_PREFERENCES) })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0);
```

and replace the two `/auth/theme` routes with:

```ts
    app.get("/auth/appearance", { preHandler: authGuard, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => service.getAppearance(request.user.id));

    app.put("/auth/appearance", { preHandler: authGuard, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
      const parsed = setAppearanceSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Unknown appearance." });
      service.setAppearance(request.user.id, parsed.data);
      return reply.code(204).send();
    });
```

- [ ] **Step 8: Verify** — Run: `npm run typecheck --workspace backend && npm test --workspace backend`. Expected: exit 0, all pass.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add backend/src/modules/auth && /usr/bin/git commit -m "Store the appearance (theme and both fonts) behind /auth/appearance

Two nullable columns join users.theme; a partial PUT updates only the
fields it names, so each client reconciles and uploads field by field.
/auth/theme goes: web and backend deploy together and mobile only runs
in Expo Go, so no released client depends on it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/src/modules/auth
```

---

### Task 3: Font files and licences

**Files:**
- Create: `frontend/public/fonts/<id>-<weight>.woff2` × 15, `frontend/public/fonts/licenses/<id>.txt` × 12
- Create: `mobile/assets/fonts/<id>-<weight>.ttf` × 15, `mobile/assets/fonts/licenses/<id>.txt` × 12

**Interfaces:**
- Consumes: the (id, weight) list from Task 1's `fonts` (every non-system font × its `weights`).
- Produces: the files at exactly those paths (Tasks 4 and 7 assert they exist).

The downloader is a throwaway script in the controller's scratchpad — do NOT commit it.

- [ ] **Step 1: Write the downloader** at `$SCRATCH/fetch-fonts.mjs` (use the scratchpad directory the controller gives you):

```js
import { mkdirSync, writeFileSync } from "node:fs";

const ROOT = process.argv[2];
const FONTS = [
  ["playfair", "Playfair Display", "playfairdisplay", [700]],
  ["literata", "Literata", "literata", [400, 700]],
  ["fraunces", "Fraunces", "fraunces", [700]],
  ["cormorant", "Cormorant Garamond", "cormorantgaramond", [600]],
  ["specialElite", "Special Elite", "specialelite", [400]],
  ["vt323", "VT323", "vt323", [400]],
  ["orbitron", "Orbitron", "orbitron", [700]],
  ["righteous", "Righteous", "righteous", [400]],
  ["pressStart", "Press Start 2P", "pressstart2p", [400]],
  ["monoton", "Monoton", "monoton", [400]],
  ["atkinson", "Atkinson Hyperlegible", "atkinsonhyperlegible", [400, 700]],
  ["jetbrainsMono", "JetBrains Mono", "jetbrainsmono", [400, 700]],
];
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function text(url, userAgent) {
  const res = await fetch(url, { headers: { "user-agent": userAgent } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function save(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  console.log("wrote", path);
}

function srcOf(block) {
  const match = /src:\s*url\(([^)]+)\)/.exec(block);
  if (!match) throw new Error(`no src in ${block}`);
  return match[1];
}

for (const dir of ["frontend/public/fonts/licenses", "mobile/assets/fonts/licenses"]) mkdirSync(`${ROOT}/${dir}`, { recursive: true });

for (const [id, family, repoDir, weights] of FONTS) {
  for (const weight of weights) {
    const css2 = `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}:wght@${weight}`;
    const web = await text(css2, CHROME);
    const latin = web.split("/* latin */")[1] ?? web;
    await save(srcOf(latin), `${ROOT}/frontend/public/fonts/${id}-${weight}.woff2`);
    const ttf = await text(css2, "curl/8");
    await save(srcOf(ttf), `${ROOT}/mobile/assets/fonts/${id}-${weight}.ttf`);
  }
  const licence = await text(`https://raw.githubusercontent.com/google/fonts/main/ofl/${repoDir}/OFL.txt`, "curl/8");
  writeFileSync(`${ROOT}/frontend/public/fonts/licenses/${id}.txt`, licence);
  writeFileSync(`${ROOT}/mobile/assets/fonts/licenses/${id}.txt`, licence);
}
```

- [ ] **Step 2: Run it** — `node $SCRATCH/fetch-fonts.mjs /Users/andreribeiro/Documents/scripta/.claude/worktrees/app-themes-expansion-71dc2a` (the worktree root).
Expected: 30 `wrote …` lines, no errors.

- [ ] **Step 3: Verify the files**

Run: `ls frontend/public/fonts/*-[0-9]*.woff2 | wc -l; ls mobile/assets/fonts/*.ttf | wc -l; ls frontend/public/fonts/licenses | wc -l; ls mobile/assets/fonts/licenses | wc -l; file frontend/public/fonts/vt323-400.woff2 mobile/assets/fonts/vt323-400.ttf; du -ch frontend/public/fonts/*-[0-9]*.woff2 | tail -1; du -ch mobile/assets/fonts/*.ttf | tail -1; head -3 frontend/public/fonts/licenses/fraunces.txt`
Expected: 15, 15, 12, 12; `file` reports "Web Open Font Format (Version 2)" and "TrueType Font data"; totals roughly ≤ 1 MB web, ≤ 3 MB mobile; the licence starts with a copyright line and mentions the SIL Open Font License. Every `.ttf` must be a static font — `fc-scan --format "%{variable}\n" mobile/assets/fonts/fraunces-700.ttf` (if `fc-scan` exists) prints `False`; if a family came back variable, stop and report BLOCKED.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add frontend/public/fonts mobile/assets/fonts && /usr/bin/git commit -m "Bundle the display and text fonts, with their OFL licences

Static instances per weight from Google Fonts: latin-subset WOFF2 for the
web and full TTF for mobile, so neither client fetches fonts at runtime.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/public/fonts mobile/assets/fonts
```

---

### Task 4: Web generated font CSS, base rules, boot script, docs

**Files:**
- Modify: `frontend/scripts/themesCss.mts`, `frontend/scripts/test-themes-css.mts`
- Regenerate: `frontend/src/themes.css` (`npm run themes --workspace frontend`)
- Modify: `frontend/src/index.css`, `frontend/index.html`, `DESIGN.md`
- Delete: `frontend/public/fonts/jetbrains-mono-regular.woff2`

**Interfaces:**
- Consumes: `FONT_IDS`, `DISPLAY_FONT_IDS`, `TEXT_FONT_IDS`, `fonts`, `fontStack`, `fontFileName`, `themes[id].fonts` (Task 1); the WOFF2 files (Task 3).
- Produces: CSS variables `--font-display`, `--font-text` in `@theme` and every `:root[data-theme]` block; override rules `:root[data-font-display="<id>"]` / `:root[data-font-text="<id>"]`; boot script setting `data-font-display` / `data-font-text`.

- [ ] **Step 1: Extend the generator tests** — append to `frontend/scripts/test-themes-css.mts` (and add `import { existsSync } from "node:fs";` plus `DISPLAY_FONT_IDS, FONT_IDS, TEXT_FONT_IDS, fontFileName, fontStack, fonts` to the `@scripta/shared/themes` import):

```ts
test("every bundled font weight gets a font face whose file exists", () => {
  const css = renderThemesCss();
  for (const id of FONT_IDS) {
    for (const weight of fonts[id].weights) {
      const file = `${fontFileName(id, weight)}.woff2`;
      assert.ok(css.includes(`src: url("/fonts/${file}") format("woff2");`), file);
      assert.ok(existsSync(new URL(`../public/fonts/${file}`, import.meta.url)), `missing public/fonts/${file}`);
    }
  }
});

test("single-weight display-only faces cover every weight, except Playfair which shares its family with the card face", () => {
  const css = renderThemesCss();
  const face = (id: string) => css.split("@font-face {").find((block) => block.includes(`/fonts/${id}-`)) ?? "";
  assert.match(face("vt323"), /font-weight: 100 900;/);
  assert.match(face("cormorant"), /font-weight: 100 900;/);
  assert.match(face("playfair"), /font-weight: 700;/);
  assert.match(face("literata"), /font-weight: 400;/);
  assert.match(face("vt323"), /size-adjust: 130%;/);
  assert.doesNotMatch(face("literata"), /size-adjust/);
});

test("every theme block sets both font variables to its defaults", () => {
  const css = renderThemesCss();
  for (const id of THEME_IDS) {
    const block = css.split(`:root[data-theme="${id}"] {`)[1]?.split("}")[0] ?? "";
    assert.ok(block.includes(`--font-display: ${fontStack(themes[id].fonts.display)};`), id);
    assert.ok(block.includes(`--font-text: ${fontStack(themes[id].fonts.text)};`), id);
  }
});

test("font override blocks exist for every pickable font and come after every theme block", () => {
  const css = renderThemesCss();
  const lastTheme = Math.max(...THEME_IDS.map((id) => css.indexOf(`:root[data-theme="${id}"] {`)));
  for (const id of DISPLAY_FONT_IDS) {
    const at = css.indexOf(`:root[data-font-display="${id}"] {\n  --font-display: ${fontStack(id)};\n}`);
    assert.ok(at > lastTheme, `display ${id}`);
  }
  for (const id of TEXT_FONT_IDS) {
    const at = css.indexOf(`:root[data-font-text="${id}"] {\n  --font-text: ${fontStack(id)};\n}`);
    assert.ok(at > lastTheme, `text ${id}`);
  }
  assert.ok(!css.includes(`[data-font-text="vt323"]`));
});
```

- [ ] **Step 2: Run to see failures** — `npm run build --workspace @scripta/shared && npm test --workspace frontend`. Expected: the new tests FAIL (no font faces or font vars yet).

- [ ] **Step 3: Extend the generator** — in `frontend/scripts/themesCss.mts`, change the import to
`import { DISPLAY_FONT_IDS, FONT_IDS, TEXT_FONT_IDS, THEME_IDS, fontFileName, fontStack, fonts, themes, type FontId, type ThemeColors } from "@scripta/shared/themes";`
and replace `renderThemesCss` (keep `WEB_TOKENS` and `declarations` as they are) with:

```ts
function fontFaces(): string[] {
  return FONT_IDS.flatMap((id) => {
    const font = fonts[id];
    if (!font.family) return [];
    const coversAllWeights = font.weights.length === 1 && !font.slots.includes("text") && id !== "playfair";
    return font.weights.map((weight) =>
      [
        "@font-face {",
        `  font-family: "${font.family}";`,
        `  src: url("/fonts/${fontFileName(id, weight)}.woff2") format("woff2");`,
        `  font-weight: ${coversAllWeights ? "100 900" : weight};`,
        "  font-style: normal;",
        "  font-display: swap;",
        ...(font.scale === 1 ? [] : [`  size-adjust: ${Math.round(font.scale * 100)}%;`]),
        "}\n",
      ].join("\n"),
    );
  });
}

function fontVariables(display: FontId, text: FontId): string {
  return `  --font-display: ${fontStack(display)};\n  --font-text: ${fontStack(text)};`;
}

export function renderThemesCss(): string {
  const darkSelectors = THEME_IDS.filter((id) => themes[id].scheme === "dark")
    .map((id) => `[data-theme="${id}"], [data-theme="${id}"] *`)
    .join(", ");
  const blocks = THEME_IDS.map(
    (id) => `:root[data-theme="${id}"] {\n  color-scheme: ${themes[id].scheme};\n${declarations(themes[id].colors)}\n${fontVariables(themes[id].fonts.display, themes[id].fonts.text)}\n}\n`,
  );
  const displayOverrides = DISPLAY_FONT_IDS.map((id) => `:root[data-font-display="${id}"] {\n  --font-display: ${fontStack(id)};\n}\n`);
  const textOverrides = TEXT_FONT_IDS.map((id) => `:root[data-font-text="${id}"] {\n  --font-text: ${fontStack(id)};\n}\n`);
  return [
    "/* Generated from @scripta/shared/themes by `npm run themes --workspace frontend`. Do not edit. */\n",
    `@custom-variant dark (&:where(${darkSelectors}));\n`,
    ...fontFaces(),
    `@theme {\n${declarations(themes.light.colors)}\n${fontVariables(themes.light.fonts.display, themes.light.fonts.text)}\n}\n`,
    ":root {\n  color-scheme: light;\n}\n",
    ...blocks,
    ...displayOverrides,
    ...textOverrides,
  ].join("\n");
}
```

Run `npm run themes --workspace frontend` to regenerate `frontend/src/themes.css`.

- [ ] **Step 4: Update `frontend/src/index.css`**
  - Delete the hand-written `@font-face { font-family: "JetBrains Mono"; … }` rule (the generated `jetbrainsMono` faces replace it) and delete the file: `/usr/bin/git rm -q frontend/public/fonts/jetbrains-mono-regular.woff2`.
  - In the comment above the hand-written faces, delete the sentences from `Regular weight only,` through `on a personal app.` (they no longer hold: Playfair and JetBrains Mono now ship real bold faces).
  - Delete the block `@theme {\n  --font-display: "Playfair Display", ui-serif, Georgia, serif;\n}` (now generated).
  - In `body { … }` replace `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;` with `font-family: var(--font-text);`.
  - Directly after the `body { … }` rule add:

```css
@layer base {
  h1,
  h2,
  h3 {
    font-family: var(--font-display);
  }
}
```

- [ ] **Step 5: Extend the boot script** in `frontend/index.html` — inside the existing IIFE, after the `document.documentElement.dataset.theme = …;` statement, add:

```js
        var displayFont = null;
        var textFont = null;
        try {
          displayFont = localStorage.getItem("fontDisplay");
          textFont = localStorage.getItem("fontText");
        } catch (err) {}
        if (displayFont && displayFont !== "theme") document.documentElement.dataset.fontDisplay = displayFont;
        if (textFont && textFont !== "theme") document.documentElement.dataset.fontText = textFont;
```

- [ ] **Step 6: Document it** — in `DESIGN.md`, insert directly after the `### Themes` subsection (before `### Tier-rank colors …`):

```markdown
### Typography

Two slots, both set per theme and overridable in Settings → Appearance: **display** (web `h1`–`h3` and the `font-display` utility; mobile text of 18pt and up or with `display`) and **text** (everything else, including inputs and buttons). The catalog lives in `packages/shared/src/themes/fonts.ts`; files are bundled (`frontend/public/fonts`, `mobile/assets/fonts`, OFL licences alongside). Defaults: Light, Dark and Midnight Playfair / System; Sepia Literata / Literata; Rosé and Forest Fraunces / System; Matrix VT323 / JetBrains Mono; Synthwave Orbitron / System; Seventies Righteous / System; Newsprint Special Elite / Literata; Oxblood Cormorant Garamond / Literata. Press Start 2P and Monoton are override-only. Text with its own font (book-card and mural styles) keeps it. The choice syncs with the theme through `/auth/appearance`.
```

- [ ] **Step 7: Verify** — `npm test --workspace frontend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm run build --workspace frontend && grep -o 'data-font-display=.\?vt323' frontend/dist/assets/*.css | wc -l`
Expected: all pass; the grep count ≥ 1 (Tailwind kept the override rules).

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add frontend/scripts/themesCss.mts frontend/scripts/test-themes-css.mts frontend/src/themes.css frontend/src/index.css frontend/index.html DESIGN.md && /usr/bin/git commit -m "Drive web headings and body text from the themed font variables

The generated CSS now declares every bundled face, gives each theme its
display/text pair, and lets data-font-* overrides win after the theme
blocks. Headings pick the display font from the base layer so explicit
font utilities still override it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/scripts/themesCss.mts frontend/scripts/test-themes-css.mts frontend/src/themes.css frontend/src/index.css frontend/index.html DESIGN.md frontend/public/fonts/jetbrains-mono-regular.woff2
```

---

### Task 5: Web font preferences and appearance sync

**Files:**
- Modify: `frontend/src/lib/theme.ts`
- Create: `frontend/src/api/appearance.ts`; delete `frontend/src/api/theme.ts`
- Create: `frontend/src/hooks/useAccountAppearanceSync.ts`; delete `frontend/src/hooks/useAccountThemeSync.ts`
- Modify: `frontend/src/layouts/DashboardLayout.tsx`, `frontend/src/components/ThemePicker.tsx`

**Interfaces:**
- Consumes: `parseFontPreference`, `parseAccountAppearance`, `reconcileAppearance`, types `Appearance`, `AccountAppearance`, `FontPreference`, `FontSlot` (Task 1); `/auth/appearance` (Task 2).
- Produces: `lib/theme.ts` — `readFontPreference(slot)`, `applyFontPreference(slot, preference)`, `useFontPreference(slot)`, `readAppearance()`, `applyAppearance(patch)`, `followAppearanceFromOtherTabs()` (replaces `followThemePreferenceFromOtherTabs`); `api/appearance.ts` — `fetchAccountAppearance()`, `saveAccountAppearance(patch)`, `isAppearanceSyncFailure(err)`; `hooks/useAccountAppearanceSync.ts` — `useAccountAppearanceSync()`.

DOM glue with no DOM test harness; the logic is in Task 1's tested functions. Verification is typecheck, lint, tests, and Task 10.

- [ ] **Step 1: Extend `frontend/src/lib/theme.ts`** — change the import to
`import { parseFontPreference, parseThemePreference, resolveTheme, type Appearance, type FontPreference, type FontSlot, type ThemePreference, type ThemeScheme } from "@scripta/shared/themes";`
replace `followThemePreferenceFromOtherTabs` with `followAppearanceFromOtherTabs` below, and add the font functions:

```ts
const FONT_KEYS: Record<FontSlot, "fontDisplay" | "fontText"> = { display: "fontDisplay", text: "fontText" };

export function readFontPreference(slot: FontSlot): FontPreference {
  try {
    return parseFontPreference(slot, localStorage.getItem(FONT_KEYS[slot]));
  } catch (err) {
    if (err instanceof DOMException) return "theme";
    throw err;
  }
}

export function applyFontPreference(slot: FontSlot, preference: FontPreference): void {
  const key = FONT_KEYS[slot];
  if (preference === "theme") delete document.documentElement.dataset[key];
  else document.documentElement.dataset[key] = preference;
  try {
    localStorage.setItem(key, preference);
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useFontPreference(slot: FontSlot): FontPreference {
  return useSyncExternalStore(subscribe, () => readFontPreference(slot));
}

export function readAppearance(): Appearance {
  return { theme: readThemePreference(), displayFont: readFontPreference("display"), textFont: readFontPreference("text") };
}

export function applyAppearance(patch: Partial<Appearance>): void {
  if (patch.theme) applyThemePreference(patch.theme);
  if (patch.displayFont) applyFontPreference("display", patch.displayFont);
  if (patch.textFont) applyFontPreference("text", patch.textFont);
}

export function followAppearanceFromOtherTabs(): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY) applyThemePreference(readThemePreference());
    if (event.key === FONT_KEYS.display) applyFontPreference("display", readFontPreference("display"));
    if (event.key === FONT_KEYS.text) applyFontPreference("text", readFontPreference("text"));
  }
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
```

- [ ] **Step 2: Create `frontend/src/api/appearance.ts`** and delete `frontend/src/api/theme.ts`:

```ts
import { parseAccountAppearance, type AccountAppearance, type Appearance } from "@scripta/shared/themes";
import { ApiError, apiFetch } from "./client";

export async function fetchAccountAppearance(): Promise<AccountAppearance> {
  return parseAccountAppearance(await apiFetch("/auth/appearance"));
}

export async function saveAccountAppearance(patch: Partial<Appearance>): Promise<void> {
  await apiFetch("/auth/appearance", { method: "PUT", body: JSON.stringify(patch) });
}

export function isAppearanceSyncFailure(err: unknown): boolean {
  return err instanceof ApiError || err instanceof TypeError;
}
```

- [ ] **Step 3: Create `frontend/src/hooks/useAccountAppearanceSync.ts`** and delete `useAccountThemeSync.ts`:

```ts
import { useEffect } from "react";
import { reconcileAppearance } from "@scripta/shared/themes";
import { fetchAccountAppearance, isAppearanceSyncFailure, saveAccountAppearance } from "../api/appearance";
import { applyAppearance, followAppearanceFromOtherTabs, readAppearance } from "../lib/theme";

async function syncOnce(): Promise<void> {
  const { apply, upload } = reconcileAppearance(await fetchAccountAppearance(), readAppearance());
  applyAppearance(apply);
  if (Object.keys(upload).length > 0) await saveAccountAppearance(upload);
}

export function useAccountAppearanceSync(): void {
  useEffect(() => {
    function run() {
      syncOnce().catch((err: unknown) => {
        if (!isAppearanceSyncFailure(err)) throw err;
      });
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") run();
    }
    run();
    document.addEventListener("visibilitychange", onVisibilityChange);
    const stopFollowing = followAppearanceFromOtherTabs();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopFollowing();
    };
  }, []);
}
```

- [ ] **Step 4: Rewire consumers**
  - `frontend/src/layouts/DashboardLayout.tsx`: import `useAccountAppearanceSync` from `../hooks/useAccountAppearanceSync` instead of `useAccountThemeSync`, and call `useAccountAppearanceSync();` where `useAccountThemeSync();` was.
  - `frontend/src/components/ThemePicker.tsx`: import `{ isAppearanceSyncFailure, saveAccountAppearance }` from `../api/appearance`; in `choose`, call `await saveAccountAppearance({ theme: preference });` and filter with `isAppearanceSyncFailure(err)`.
  - `grep -rn 'api/theme\|useAccountThemeSync\|followThemePreferenceFromOtherTabs\|/auth/theme' frontend/src` must print nothing.

- [ ] **Step 5: Verify** — `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`. Expected: exit 0 / all pass; no new lint warnings in touched files.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add frontend/src/lib/theme.ts frontend/src/api/appearance.ts frontend/src/api/theme.ts frontend/src/hooks/useAccountAppearanceSync.ts frontend/src/hooks/useAccountThemeSync.ts frontend/src/layouts/DashboardLayout.tsx frontend/src/components/ThemePicker.tsx && /usr/bin/git commit -m "Sync web font choices with the theme through /auth/appearance

Fonts are cached per device next to the theme and applied as data-font-*
attributes; one GET reconciles all three fields and other tabs follow any
of them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/src/lib/theme.ts frontend/src/api/appearance.ts frontend/src/api/theme.ts frontend/src/hooks/useAccountAppearanceSync.ts frontend/src/hooks/useAccountThemeSync.ts frontend/src/layouts/DashboardLayout.tsx frontend/src/components/ThemePicker.tsx
```

---

### Task 6: Web font pickers in Settings

**Files:**
- Create: `frontend/src/components/FontPicker.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx` (Appearance section)

**Interfaces:**
- Consumes: `DISPLAY_FONT_IDS`, `TEXT_FONT_IDS`, `fonts`, `fontStack`, `resolveFonts`, `resolveTheme`, types (Task 1); `applyFontPreference`, `useFontPreference`, `useThemePreference`, `osScheme` (Task 5); `saveAccountAppearance`, `isAppearanceSyncFailure` (Task 5).

- [ ] **Step 1: Create `frontend/src/components/FontPicker.tsx`**

```tsx
import { useState } from "react";
import { DISPLAY_FONT_IDS, TEXT_FONT_IDS, fontStack, fonts, resolveFonts, resolveTheme, type FontPreference, type FontSlot } from "@scripta/shared/themes";
import { isAppearanceSyncFailure, saveAccountAppearance } from "../api/appearance";
import { applyFontPreference, osScheme, useFontPreference, useThemePreference } from "../lib/theme";

export function FontPicker({ slot }: { slot: FontSlot }) {
  const selected = useFontPreference(slot);
  const themeDefault = resolveFonts(resolveTheme(useThemePreference(), osScheme()), "theme", "theme")[slot];
  const [error, setError] = useState<string | null>(null);
  const options: FontPreference[] = ["theme", ...(slot === "display" ? DISPLAY_FONT_IDS : TEXT_FONT_IDS)];

  async function choose(preference: FontPreference) {
    applyFontPreference(slot, preference);
    setError(null);
    try {
      await saveAccountAppearance(slot === "display" ? { displayFont: preference } : { textFont: preference });
    } catch (err) {
      if (!isAppearanceSyncFailure(err)) throw err;
      setError("Couldn't save to your account. Try again.");
    }
  }

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold text-(--color-text-dim)">{slot === "display" ? "Headings" : "Text"}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const shown = option === "theme" ? themeDefault : option;
          return (
            <label key={option} className="cursor-pointer">
              <input type="radio" name={`font-${slot}`} value={option} checked={selected === option} onClick={() => void choose(option)} readOnly className="peer sr-only" />
              <span
                className="block rounded-lg border border-(--color-border) px-3 py-1.5 text-sm peer-checked:border-(--color-accent) peer-checked:ring-1 peer-checked:ring-(--color-accent) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--color-accent)"
                style={{ fontFamily: fontStack(shown) }}
              >
                {option === "theme" ? `Theme default · ${fonts[themeDefault].label}` : fonts[option].label}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-(--color-danger)">
          {error}
        </p>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 2: Add it to Settings** — in `frontend/src/pages/SettingsPage.tsx`, import `{ FontPicker }` from `../components/FontPicker`, and directly after `<ThemePicker />` inside the Appearance section add:

```tsx
        <div className="mt-5 space-y-4">
          <FontPicker slot="display" />
          <FontPicker slot="text" />
        </div>
```

- [ ] **Step 3: Verify** — `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend` (the on-accent guard must still pass).

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add frontend/src/components/FontPicker.tsx frontend/src/pages/SettingsPage.tsx && /usr/bin/git commit -m "Add heading and text font pickers to Settings > Appearance

Each chip is written in its own font; the first names the font the
current theme resolves to, so Theme default is never a mystery.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- frontend/src/components/FontPicker.tsx frontend/src/pages/SettingsPage.tsx
```

---

### Task 7: Mobile font loading, font preferences and appearance sync

**Files:**
- Modify: `mobile/package.json`, `package-lock.json` (add `expo-font`)
- Create: `mobile/src/ui/fontAssets.ts`, `mobile/src/ui/fontStyle.ts`
- Test: `mobile/src/ui/fontStyle.test.ts`, `mobile/src/ui/fontAssets.test.ts`
- Modify: `mobile/src/ui/theme.tsx`, `mobile/src/app/_layout.tsx`
- Create: `mobile/src/features/settings/appearanceSync.ts`; delete `mobile/src/features/settings/themeSync.ts`
- Modify: `mobile/src/app/(app)/_layout.tsx`, `mobile/src/features/settings/ThemePicker.tsx`
- Modify: `packages/shared/src/themes/preference.ts`, `packages/shared/src/themes/themes.test.ts` (remove `reconcileThemePreference`)

**Interfaces:**
- Consumes: Task 1's catalog and preference API; `/auth/appearance`; the TTF files (Task 3).
- Produces:
  - `fontStyle.ts`: `DISPLAY_MIN_FONT_SIZE = 18`, `type FontStyleInput = { fontFamily?: string; fontWeight?: string | number; fontSize?: number; lineHeight?: number }`, `slotFor(fontSize?: number, display?: boolean): FontSlot`, `fontStyleFor(font: FontId, slot: FontSlot, style: FontStyleInput): { fontFamily: string; fontWeight: "normal"; fontSize?: number; lineHeight?: number } | null`.
  - `fontAssets.ts`: `FONT_ASSETS` (`Record<string, number>` of `"<id>-<weight>"` → `require(...)`).
  - `useTheme()` gains `fonts: { display: FontId; text: FontId }`, `displayFont: FontPreference`, `textFont: FontPreference`, `setFontPreference(slot: FontSlot, preference: FontPreference): void`. `ThemeProvider` takes `bundledFonts: boolean`.
  - `appearanceSync.ts`: `fetchAccountAppearance()`, `saveAccountAppearance(patch)`, `isAppearanceSyncFailure(err)`, `useAccountAppearanceSync()`.

- [ ] **Step 1: Add `expo-font` as a direct dependency** (worktree `node_modules` are links into the main checkout — never install through them):

```bash
npm install --package-lock-only -w mobile expo-font@~57.0.4
```
```bash
rm mobile/node_modules frontend/node_modules && rm -rf node_modules
```
```bash
npm run dev:link-deps
```
```bash
npm run build --workspace @scripta/shared
```
Expected: `mobile/package.json` gains `"expo-font": "~57.0.4"`; `dev:link-deps` sees the lockfile change and runs a real install in the worktree. Check: `node -p 'require("expo-font/package.json").version'` from `mobile/` prints `57.0.4`.

- [ ] **Step 2: Write the failing tests** — `mobile/src/ui/fontStyle.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DISPLAY_MIN_FONT_SIZE, fontStyleFor, slotFor } from "./fontStyle";

test("slotFor picks display from 18pt up unless display says otherwise", () => {
  assert.equal(DISPLAY_MIN_FONT_SIZE, 18);
  assert.equal(slotFor(undefined, undefined), "text");
  assert.equal(slotFor(17, undefined), "text");
  assert.equal(slotFor(18, undefined), "display");
  assert.equal(slotFor(24, false), "text");
  assert.equal(slotFor(12, true), "display");
});

test("system fonts and text with its own family are left alone", () => {
  assert.equal(fontStyleFor("system", "text", { fontSize: 14 }), null);
  assert.equal(fontStyleFor("system", "display", { fontSize: 24 }), null);
  assert.equal(fontStyleFor("literata", "text", { fontFamily: "serif", fontSize: 14 }), null);
});

test("text fonts map weight to the bundled file and reset fontWeight", () => {
  assert.deepEqual(fontStyleFor("literata", "text", { fontSize: 14 }), { fontFamily: "literata-400", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("literata", "text", { fontWeight: "700" }), { fontFamily: "literata-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("atkinson", "text", { fontWeight: "600" }), { fontFamily: "atkinson-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("atkinson", "text", { fontWeight: "bold" }), { fontFamily: "atkinson-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("jetbrainsMono", "text", { fontWeight: "normal" }), { fontFamily: "jetbrainsMono-400", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("jetbrainsMono", "text", { fontWeight: 500 }), { fontFamily: "jetbrainsMono-400", fontWeight: "normal" });
});

test("display fonts use their heading weight and scale size and line height", () => {
  assert.deepEqual(fontStyleFor("playfair", "display", { fontSize: 24, lineHeight: 30, fontWeight: "700" }), { fontFamily: "playfair-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("literata", "display", { fontSize: 18 }), { fontFamily: "literata-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("vt323", "display", { fontSize: 24, lineHeight: 30 }), { fontFamily: "vt323-400", fontWeight: "normal", fontSize: 31, lineHeight: 39 });
  assert.deepEqual(fontStyleFor("pressStart", "display", {}), { fontFamily: "pressStart-400", fontWeight: "normal", fontSize: 10 });
  assert.deepEqual(fontStyleFor("cormorant", "display", { fontSize: 24 }), { fontFamily: "cormorant-600", fontWeight: "normal", fontSize: 27 });
});
```

`mobile/src/ui/fontAssets.test.ts` (tests run with `mobile/` as the working directory):

```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { FONT_IDS, fontFileName, fonts } from "@scripta/shared/themes";

test("every bundled font weight is registered and its file exists", () => {
  const source = readFileSync("src/ui/fontAssets.ts", "utf8");
  for (const id of FONT_IDS) {
    for (const weight of fonts[id].weights) {
      const name = fontFileName(id, weight);
      assert.ok(source.includes(`"${name}": require("../../assets/fonts/${name}.ttf")`), name);
      assert.ok(existsSync(`assets/fonts/${name}.ttf`), `missing assets/fonts/${name}.ttf`);
    }
  }
});
```

Run: `npm test --workspace mobile` — Expected: FAIL (modules not found).

- [ ] **Step 3: Create `mobile/src/ui/fontStyle.ts`**

```ts
import { fontFileName, fonts, type FontId, type FontSlot, type FontWeight } from "@scripta/shared/themes";

export const DISPLAY_MIN_FONT_SIZE = 18;
const DEFAULT_FONT_SIZE = 14;

export type FontStyleInput = { fontFamily?: string; fontWeight?: string | number; fontSize?: number; lineHeight?: number };

export function slotFor(fontSize?: number, display?: boolean): FontSlot {
  if (display !== undefined) return display ? "display" : "text";
  return (fontSize ?? DEFAULT_FONT_SIZE) >= DISPLAY_MIN_FONT_SIZE ? "display" : "text";
}

function numericWeight(weight: string | number | undefined): number {
  if (weight === "bold") return 700;
  return Number(weight) || 400;
}

export function fontStyleFor(font: FontId, slot: FontSlot, style: FontStyleInput): { fontFamily: string; fontWeight: "normal"; fontSize?: number; lineHeight?: number } | null {
  const definition = fonts[font];
  if (style.fontFamily || !definition.family) return null;
  const heaviest = Math.max(...definition.weights) as FontWeight;
  const lightest = Math.min(...definition.weights) as FontWeight;
  const weight = slot === "display" || numericWeight(style.fontWeight) >= 600 ? heaviest : lightest;
  const result: { fontFamily: string; fontWeight: "normal"; fontSize?: number; lineHeight?: number } = { fontFamily: fontFileName(font, weight), fontWeight: "normal" };
  if (definition.scale !== 1) {
    result.fontSize = Math.round((style.fontSize ?? DEFAULT_FONT_SIZE) * definition.scale);
    if (style.lineHeight) result.lineHeight = Math.round(style.lineHeight * definition.scale);
  }
  return result;
}
```

- [ ] **Step 4: Create `mobile/src/ui/fontAssets.ts`**

```ts
export const FONT_ASSETS: Record<string, number> = {
  "playfair-700": require("../../assets/fonts/playfair-700.ttf"),
  "literata-400": require("../../assets/fonts/literata-400.ttf"),
  "literata-700": require("../../assets/fonts/literata-700.ttf"),
  "fraunces-700": require("../../assets/fonts/fraunces-700.ttf"),
  "cormorant-600": require("../../assets/fonts/cormorant-600.ttf"),
  "specialElite-400": require("../../assets/fonts/specialElite-400.ttf"),
  "vt323-400": require("../../assets/fonts/vt323-400.ttf"),
  "orbitron-700": require("../../assets/fonts/orbitron-700.ttf"),
  "righteous-400": require("../../assets/fonts/righteous-400.ttf"),
  "pressStart-400": require("../../assets/fonts/pressStart-400.ttf"),
  "monoton-400": require("../../assets/fonts/monoton-400.ttf"),
  "atkinson-400": require("../../assets/fonts/atkinson-400.ttf"),
  "atkinson-700": require("../../assets/fonts/atkinson-700.ttf"),
  "jetbrainsMono-400": require("../../assets/fonts/jetbrainsMono-400.ttf"),
  "jetbrainsMono-700": require("../../assets/fonts/jetbrainsMono-700.ttf"),
};
```

Run `npm test --workspace mobile` — the two new test files PASS.

- [ ] **Step 5: Extend `mobile/src/ui/theme.tsx`**
  - Imports: add `parseFontPreference, resolveFonts, type FontId, type FontPreference, type FontSlot` to the `@scripta/shared/themes` import.
  - `Theme` type gains: `fonts: { display: FontId; text: FontId }; displayFont: FontPreference; textFont: FontPreference; setFontPreference: (slot: FontSlot, preference: FontPreference) => void;`.
  - Add `const FONT_KEYS: Record<FontSlot, string> = { display: "fontDisplay", text: "fontText" };` and `const SYSTEM_FONTS = { display: "system", text: "system" } as const;`.
  - Replace `ThemeProvider` with:

```tsx
export function ThemeProvider({ children, bundledFonts }: { children: ReactNode; bundledFonts: boolean }) {
  const scheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference | null>(null);
  const [displayFont, setDisplayFont] = useState<FontPreference>("theme");
  const [textFont, setTextFont] = useState<FontPreference>("theme");

  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, FONT_KEYS.display, FONT_KEYS.text]).then(
      (entries) => {
        const stored = new Map(entries);
        const parsed = parseThemePreference(stored.get(STORAGE_KEY));
        applyNativeScheme(parsed);
        setDisplayFont(parseFontPreference("display", stored.get(FONT_KEYS.display)));
        setTextFont(parseFontPreference("text", stored.get(FONT_KEYS.text)));
        setPreferenceState(parsed);
      },
      (err: unknown) => {
        console.warn("Couldn't read the saved appearance; following the system.", err);
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

  const setFontPreference = useCallback((slot: FontSlot, next: FontPreference) => {
    if (slot === "display") setDisplayFont(next);
    else setTextFont(next);
    AsyncStorage.setItem(FONT_KEYS[slot], next).catch((err: unknown) => {
      console.warn("Couldn't save the font on this device.", err);
    });
  }, []);

  const value = useMemo<Theme | null>(() => {
    if (!preference) return null;
    const id = resolveTheme(preference, osScheme(scheme));
    const fonts = bundledFonts ? resolveFonts(id, displayFont, textFont) : SYSTEM_FONTS;
    return { id, mode: themes[id].scheme, colors: themes[id].colors, preference, setPreference, fonts, displayFont, textFont, setFontPreference };
  }, [preference, scheme, setPreference, bundledFonts, displayFont, textFont, setFontPreference]);

  if (!value) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
```

  - In `useTheme()`'s fallback object add `fonts: SYSTEM_FONTS, displayFont: "theme", textFont: "theme", setFontPreference: () => { throw new Error("setFontPreference needs a ThemeProvider above it."); },`.

- [ ] **Step 6: Load fonts in `mobile/src/app/_layout.tsx`** — add imports `import { useEffect, useMemo } from "react";` (merge with the existing `useMemo` import), `import { useFonts } from "expo-font";`, `import * as SplashScreen from "expo-splash-screen";`, `import { FONT_ASSETS } from "../ui/fontAssets";`; add at module level after the imports `void SplashScreen.preventAutoHideAsync();`; replace `RootLayout` with:

```tsx
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  useEffect(() => {
    if (fontError) console.warn("Couldn't load the bundled fonts; using system fonts.", fontError);
  }, [fontError]);
  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
          <ThemeProvider bundledFonts={fontsLoaded}>
            <AuthProvider>
              <AccountRoutes />
            </AuthProvider>
          </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 7: Replace the sync** — create `mobile/src/features/settings/appearanceSync.ts`, delete `themeSync.ts`:

```ts
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { parseAccountAppearance, reconcileAppearance, type AccountAppearance, type Appearance } from "@scripta/shared/themes";
import { ApiError, apiClient } from "../../core/api";
import { useTheme } from "../../ui/theme";

export async function fetchAccountAppearance(): Promise<AccountAppearance> {
  return parseAccountAppearance(await apiClient.request<unknown>("/auth/appearance", { auth: true }));
}

export async function saveAccountAppearance(patch: Partial<Appearance>): Promise<void> {
  await apiClient.request("/auth/appearance", { method: "PUT", body: patch, auth: true });
}

export function isAppearanceSyncFailure(err: unknown): boolean {
  return err instanceof ApiError || err instanceof TypeError;
}

export function useAccountAppearanceSync(): void {
  const { preference, displayFont, textFont, setPreference, setFontPreference } = useTheme();
  const latest = useRef<Appearance>({ theme: preference, displayFont, textFont });

  useEffect(() => {
    latest.current = { theme: preference, displayFont, textFont };
  }, [preference, displayFont, textFont]);

  useEffect(() => {
    async function syncOnce() {
      const { apply, upload } = reconcileAppearance(await fetchAccountAppearance(), latest.current);
      if (apply.theme) setPreference(apply.theme);
      if (apply.displayFont) setFontPreference("display", apply.displayFont);
      if (apply.textFont) setFontPreference("text", apply.textFont);
      if (Object.keys(upload).length > 0) await saveAccountAppearance(upload);
    }
    function run() {
      syncOnce().catch((err: unknown) => {
        if (!isAppearanceSyncFailure(err)) throw err;
      });
    }
    run();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => subscription.remove();
  }, [setPreference, setFontPreference]);
}
```

  - `mobile/src/app/(app)/_layout.tsx`: import `useAccountAppearanceSync` from `../../features/settings/appearanceSync`; rename the `ThemeSync` component to `AppearanceSync` calling `useAccountAppearanceSync()`, and render `<AppearanceSync />` where `<ThemeSync />` was.
  - `mobile/src/features/settings/ThemePicker.tsx`: import `{ isAppearanceSyncFailure, saveAccountAppearance }` from `./appearanceSync`; call `saveAccountAppearance({ theme: next })` and filter with `isAppearanceSyncFailure(err)`.

- [ ] **Step 8: Retire the old rule** — in `packages/shared/src/themes/preference.ts` delete `reconcileThemePreference`; in `packages/shared/src/themes/themes.test.ts` delete the `reconcileThemePreference` test and its import. Then:
`grep -rn 'reconcileThemePreference\|themeSync\|/auth/theme' packages/shared/src mobile/src frontend/src backend/src` must print nothing.

- [ ] **Step 9: Verify** — `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile && npm run typecheck --workspace frontend && npm test --workspace frontend`. Expected: all pass.

- [ ] **Step 10: Commit**

```bash
/usr/bin/git add mobile/package.json package-lock.json mobile/src/ui/fontStyle.ts mobile/src/ui/fontStyle.test.ts mobile/src/ui/fontAssets.ts mobile/src/ui/fontAssets.test.ts mobile/src/ui/theme.tsx mobile/src/app/_layout.tsx mobile/src/features/settings/appearanceSync.ts mobile/src/features/settings/themeSync.ts "mobile/src/app/(app)/_layout.tsx" mobile/src/features/settings/ThemePicker.tsx packages/shared/src/themes/preference.ts packages/shared/src/themes/themes.test.ts && /usr/bin/git commit -m "Load bundled fonts on mobile and sync font choices with the theme

The splash holds until fonts load; if they fail the provider resolves
both slots to System instead of naming faces that were never registered.
Font preferences live next to the theme and reconcile per field.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/package.json package-lock.json mobile/src/ui/fontStyle.ts mobile/src/ui/fontStyle.test.ts mobile/src/ui/fontAssets.ts mobile/src/ui/fontAssets.test.ts mobile/src/ui/theme.tsx mobile/src/app/_layout.tsx mobile/src/features/settings/appearanceSync.ts mobile/src/features/settings/themeSync.ts "mobile/src/app/(app)/_layout.tsx" mobile/src/features/settings/ThemePicker.tsx packages/shared/src/themes/preference.ts packages/shared/src/themes/themes.test.ts
```

---

### Task 8: Mobile shared `Text` and the switch-over

**Files:**
- Create: `mobile/src/ui/Text.tsx`
- Test: `mobile/src/ui/textImports.test.ts`
- Modify: every file under `mobile/src` that imports `Text` from `"react-native"` (~73, via the codemod below)
- Modify: `mobile/src/ui/components.tsx` (`Input` applies the text font to its `TextInput`), `mobile/src/ui/navigation.tsx`, `mobile/src/app/(app)/_layout.tsx` (tab labels)

**Interfaces:**
- Consumes: `useTheme().fonts` (Task 7); `fontStyleFor`, `slotFor` (Task 7).
- Produces: `Text` from `mobile/src/ui/Text.tsx` — React Native `Text` props plus `display?: boolean`.

- [ ] **Step 1: Write the guard test** `mobile/src/ui/textImports.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("only ui/Text.tsx imports Text from react-native", () => {
  const offenders = sources("src").filter((file) => {
    if (file === join("src", "ui", "Text.tsx")) return false;
    const imports = readFileSync(file, "utf8").match(/import\s*\{[^}]*\}\s*from\s*"react-native"/g) ?? [];
    return imports.some((clause) => /[{,]\s*Text\s*[,}]/.test(clause));
  });
  assert.deepEqual(offenders, []);
});
```

Run `npm test --workspace mobile` — Expected: FAIL listing ~73 files.

- [ ] **Step 2: Create `mobile/src/ui/Text.tsx`**

```tsx
import type { ComponentProps } from "react";
import { StyleSheet, Text as NativeText } from "react-native";
import { fontStyleFor, slotFor, type FontStyleInput } from "./fontStyle";
import { useTheme } from "./theme";

export function Text({ display, style, ...props }: ComponentProps<typeof NativeText> & { display?: boolean }) {
  const { fonts } = useTheme();
  const flat = (StyleSheet.flatten(style) ?? {}) as FontStyleInput;
  const slot = slotFor(flat.fontSize, display);
  const themed = fontStyleFor(fonts[slot], slot, flat);
  return <NativeText {...props} style={themed ? [style, themed] : style} />;
}
```

- [ ] **Step 3: Run the codemod** — save as `$SCRATCH/codemod-text.mjs` (scratchpad, not committed) and run `node $SCRATCH/codemod-text.mjs` from the worktree root:

```js
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const clause = /import\s*\{([^}]*)\}\s*from\s*"react-native";/;
let changed = 0;
for (const file of walk("mobile/src")) {
  if (file === join("mobile", "src", "ui", "Text.tsx") || file.endsWith(".test.ts")) continue;
  const source = readFileSync(file, "utf8");
  const match = source.match(clause);
  if (!match) continue;
  const names = match[1].split(",").map((name) => name.trim()).filter(Boolean);
  if (!names.includes("Text")) continue;
  const kept = names.filter((name) => name !== "Text");
  let path = relative(dirname(file), join("mobile", "src", "ui", "Text"));
  if (!path.startsWith(".")) path = `./${path}`;
  const replacement = `${kept.length ? `import { ${kept.join(", ")} } from "react-native";\n` : ""}import { Text } from "${path}";`;
  writeFileSync(file, source.replace(clause, replacement));
  changed += 1;
}
console.log(`rewrote ${changed} files`);
```

Expected: `rewrote 7x files`. Then `npm test --workspace mobile` — the guard test PASSES. Inspect `git diff --stat` — only import lines should change.

- [ ] **Step 4: Apply the text font to the one `TextInput`** — in `mobile/src/ui/components.tsx`, inside `Input`, get `const { fonts } = useTheme();` (it may already destructure `useTheme()` — add `fonts` to that), and append the themed style to the `TextInput`'s `style` array: `fontStyleFor(fonts.text, "text", { fontSize: typography.input.fontSize }) ?? null` (import `fontStyleFor` from `./fontStyle`; use the actual font size the input style already uses if it isn't `typography.input`).

- [ ] **Step 5: Header titles and tab labels**
  - `mobile/src/ui/navigation.tsx` `useScreenOptions`: destructure `fonts` from `useTheme()` (import `fontStyleFor` from `./fontStyle`) and set
    `headerTitleStyle: { color: colors.text, fontWeight: "700", ...fontStyleFor(fonts.display, "display", { fontSize: 17 }) },`
    `headerLargeTitleStyle: { color: colors.text, ...fontStyleFor(fonts.display, "display", { fontSize: 34 }) },`
    (spreading `null` is a no-op, so System keeps today's look).
  - `mobile/src/app/(app)/_layout.tsx`: destructure `fonts` from its existing `useTheme()` call and add to the `Tabs` `screenOptions`: `tabBarLabelStyle: fontStyleFor(fonts.text, "text", { fontSize: 10 }) ?? undefined,` (import `fontStyleFor` from `../../ui/fontStyle`).

- [ ] **Step 6: Verify** — `npm run typecheck --workspace mobile && npm test --workspace mobile`. Expected: exit 0, all pass (including the guard).

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add mobile/src && /usr/bin/git commit -m "Route every mobile Text through a themed component

React Native has no app-wide font, so text now resolves its font from the
theme: 18pt and up takes the display slot, the rest the text slot, and an
explicit fontFamily (card and mural styles) always wins. A guard test
keeps new screens from importing the bare Text again.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src
```

---

### Task 9: Mobile font pickers in Settings

**Files:**
- Create: `mobile/src/features/settings/FontPicker.tsx`
- Modify: `mobile/src/features/settings/SettingsScreen.tsx` (Appearance section)

**Interfaces:**
- Consumes: Task 1 catalog; `useTheme()` fonts API (Task 7); `fontStyleFor` (Task 7); `Text` (Task 8); `saveAccountAppearance`, `isAppearanceSyncFailure` (Task 7).

- [ ] **Step 1: Create `mobile/src/features/settings/FontPicker.tsx`**

```tsx
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { DISPLAY_FONT_IDS, TEXT_FONT_IDS, fonts, resolveFonts, type FontId, type FontPreference, type FontSlot } from "@scripta/shared/themes";
import { fontStyleFor } from "../../ui/fontStyle";
import { Text } from "../../ui/Text";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { isAppearanceSyncFailure, saveAccountAppearance } from "./appearanceSync";

const SYSTEM_FAMILY = Platform.select({ ios: "System", default: "sans-serif" });

function sampleStyle(font: FontId, slot: FontSlot) {
  return fontStyleFor(font, slot, typography.body) ?? { fontFamily: SYSTEM_FAMILY };
}

export function FontPicker({ slot }: { slot: FontSlot }) {
  const { id, colors, displayFont, textFont, setFontPreference } = useTheme();
  const selected = slot === "display" ? displayFont : textFont;
  const themeDefault = resolveFonts(id, "theme", "theme")[slot];
  const [error, setError] = useState<string | null>(null);
  const options: FontPreference[] = ["theme", ...(slot === "display" ? DISPLAY_FONT_IDS : TEXT_FONT_IDS)];

  function choose(next: FontPreference) {
    setFontPreference(slot, next);
    setError(null);
    saveAccountAppearance(slot === "display" ? { displayFont: next } : { textFont: next }).catch((err: unknown) => {
      if (!isAppearanceSyncFailure(err)) throw err;
      setError("Couldn't save to your account. Try again.");
    });
  }

  return (
    <View style={styles.wrap}>
      <Text {...dynamicType} style={[typography.caption, styles.heading, { color: colors.textDim }]}>
        {slot === "display" ? "Headings" : "Text"}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={slot === "display" ? "Heading font" : "Text font"} style={styles.row}>
        {options.map((option) => {
          const checked = option === selected;
          const shown = option === "theme" ? themeDefault : option;
          const label = option === "theme" ? `Theme default · ${fonts[themeDefault].label}` : fonts[option].label;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={label}
              onPress={() => choose(option)}
              style={[styles.chip, { borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accentSoft : colors.surface }]}
            >
              <Text {...dynamicType} style={[typography.body, { color: colors.text }, sampleStyle(shown, slot)]}>
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
  wrap: { gap: spacing.sm },
  heading: { fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: minimumTouchTarget, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1 },
});
```

- [ ] **Step 2: Add it to Settings** — in `SettingsScreen.tsx`, import `{ FontPicker }` from `./FontPicker` and add `<FontPicker slot="display" />` and `<FontPicker slot="text" />` directly after `<ThemePicker />` inside the Appearance section.

- [ ] **Step 3: Verify** — `npm run typecheck --workspace mobile && npm test --workspace mobile`.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add mobile/src/features/settings/FontPicker.tsx mobile/src/features/settings/SettingsScreen.tsx && /usr/bin/git commit -m "Add heading and text font pickers to the mobile Appearance settings

Same chips as the web, each written in its own font, each a radio with
its checked state exposed to screen readers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/features/settings/FontPicker.tsx mobile/src/features/settings/SettingsScreen.tsx
```

---

### Task 10: Whole-branch verification (controller)

Run by the main session after the final review.

- [ ] **Step 1: Automated pass** — `npm run build --workspace @scripta/shared`, then each: shared test; backend typecheck + test; frontend typecheck + lint + test; mobile typecheck + test; `npm run check:agents`; `npm run test:scripts`. All exit 0.

- [ ] **Step 2: Browser pass** (claimed slot, seeded dev account, per `docs/dev-workflow.md`):
  1. Settings → Appearance shows Headings and Text chips, each in its own font; "Theme default · Playfair" under Light.
  2. Pick Matrix → headings VT323, body JetBrains Mono; pick Sepia → Literata both; the Theme default chips follow (Review Focus 2).
  3. Override Headings → Press Start 2P, switch theme to Oxblood → headings stay Press Start 2P, text follows Oxblood (Literata) (Review Focus 2, 5).
  4. `localStorage.fontText = "vt323"`, reload → text uses the theme default, no console errors (Review Focus 1).
  5. A book card with a card-style font (e.g. Playfair) keeps it under Matrix (Review Focus 4).
  6. Network panel: one `GET /auth/appearance` per focus; picking a font sends a `PUT` with only that field.

- [ ] **Step 3: Device pass** (only if `node scripts/dev-status.mjs --json` shows a free lease): Matrix, Oxblood and a Press Start 2P override on Home, My shelf and Settings; header title and tab labels readable, nothing overflowing (Review Focus 5); cold start keeps fonts; book cards keep their own font (Review Focus 4). Report iOS bold as unverified.

- [ ] **Step 4: Report** each step's outcome, including skips and scale values that needed tuning.
