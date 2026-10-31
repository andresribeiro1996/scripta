# European Portuguese (pt-PT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every reader-facing string on web, mobile, `@scripta/shared` and the backend exists in English and European Portuguese. The language is picked automatically from the device and can be changed in settings, synced to the account.

**Architecture:**
- **Shared core.** A dependency-free core in `@scripta/shared/i18n` provides the locale type, device-tag resolution, a typed `createTranslator` with `{var}` interpolation and one/other plurals, and a catalog checker.
- **Catalogs.** Each package owns its catalogs as plain TypeScript objects, `pt-PT` typed against `en`, so a missing key fails `typecheck`.
- **Clients.** Each client keeps the active locale in a module store, sends it as `Accept-Language`, and syncs the preference through the existing `/auth/appearance` endpoint.
- **Backend.** The backend translates its own `error` strings and emails from the request's `Accept-Language`.

**Tech Stack:** TypeScript, React/Vite (web), Expo SDK 58 / React Native (mobile), Fastify + zod 3 + SQLite (backend), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-31-portuguese-language-design.md`

## Global Constraints

- Locales are exactly `"en"` and `"pt-PT"`. Preferences are `"auto" | "en" | "pt-PT"`.
- Resolution:
  1. An explicit pick wins.
  2. Otherwise the **first** device tag: any tag starting `pt` (case-insensitive, `-` or `_`) → `pt-PT`.
  3. Anything else, or no tag → `en`.
- English output stays word-for-word as today. Every existing test keeps passing with only mechanical changes, such as passing `"en"` to a helper that gained a `locale` parameter.
- **Client locale stores are pure modules.** Each holds an in-memory pick and device tags that default to `[]`. Nothing touches `window`, `document`, `localStorage`, `navigator`, `react-native` or AsyncStorage at import.
  - A separate startup module does all of that: `frontend/src/i18n/browser.ts`, called from `main.tsx`, and `mobile/src/i18n/native.ts`, called from the root `_layout.tsx`. It loads the stored pick, feeds device tags, listens for language and `AppState` changes, persists picks and sets `<html lang>`.
  - Tests never call it, so they see no device tags whatever the Mac's `LANG` is. Node 26 has a global `navigator` that reports `LANG`, so this matters.
- **Tests run in English by default.** A test switches with `setLocalePreference("pt-PT")` and resets to `"auto"` afterwards. The backend sees no `Accept-Language` in tests.
- **Prelaunch rule (until Task 36).** `getLocale()` returns `"pt-PT"` only when `PORTUGUESE_ENABLED` is true and the pick is exactly `"pt-PT"`. Everything else, including `"auto"` on a Portuguese device, gives `"en"`.
  - Why: the user's Mac and phone are set to Portuguese. This keeps every dev setup fully English until launch, so nobody sees half-translated screens mid-project.
  - The picker renders only when `PORTUGUESE_ENABLED` is true.
  - Web: `PORTUGUESE_ENABLED = import.meta.env?.DEV !== false`. It is on in dev and tests and `false` in `vite build` (verified on Vite 8.2.2).
  - Mobile: `PORTUGUESE_ENABLED = typeof __DEV__ === "undefined" || __DEV__`. It is on in dev and tests and off in release builds and OTAs.
  - Task 36 replaces the rule with `resolveLocale(pick, deviceTags)`.
  - The backend has no flag. It follows whatever `Accept-Language` the client sends.
- **Phases 2, 3 and 4 never edit `packages/shared`**, because they run in parallel sessions. A shared string found missing in those phases is listed in that PR's description and converted in Task 36.
- **Deploy order.** For every PR that touches `/auth/appearance`, deploy the backend before Pages and the OTA. `setAppearanceSchema` is `.strict()`, so an old backend rejects the whole upload when it contains `locale`.
- Locale-taking helpers in `@scripta/shared` take a **required** `locale: Locale` parameter. It goes right after their existing required parameters and before optional ones, e.g. `relativeTime(iso, locale, now?)`. This makes `typecheck` find every caller, so no Portuguese screen can silently get English from a forgotten call.
- `Intl` is used only for `toLocaleDateString` (weekday/long dates). Pass `undefined` for `"en"`, so English stays on the runtime default as today, and `"pt-PT"` for Portuguese. Plurals are `count === 1 ? one : other`, which is correct for both locales, so `Intl.PluralRules` is not needed.
- Interpolated numbers are inserted with `String(n)`, the same as today's English. Pre-format where today's code already formats (e.g. `toLocaleString`).
- **Out of scope:**
  - admin/editor surfaces: `frontend/src/pages/Admin*Page.tsx`, `components/{Genre,Synopsis,Translation}ReviewList.tsx`, the admin console, `quizzes/dailyChapterService.ts` + `dailyChapterValidation.ts` errors, `books` admin routes, `ALERT_EMAIL` alerts, `works/{genreReview,synopsisReview,translationReview}.ts`
  - the `PrivacyPage.tsx` body (its chrome is in scope)
  - book data: titles, authors, synopses, series, `quizzes/pool.ts`, `components/landing/books.ts`
  - Daily Chapter editorial rows
  - `index.html` meta and the PWA manifest
- **Native permission strings (`mobile/app.json:89,113`) are dropped from scope.** Their text is iOS-only (`NS*UsageDescription`). Android permission dialogs show system text, and the app ships only to Google Play. No store build is needed for this feature.
- **Saved defaults** are written in the creator's locale at creation and then frozen. This covers mural preset titles, "Untitled tier list" and "New tier". Existing rows are not migrated.
- Award names: translate the English-named ones into the form the Portuguese press uses (e.g. "Booker Prize" → "Prémio Booker"). Names already in Portuguese are unchanged.

### Portuguese copy rules

- European Portuguese, AO1990 spelling: ação, atual, coleção, aspeto, ótimo.
- **Never "tu"/"teu".** Buttons and menu items use the infinitive ("Guardar", "Cancelar"). Instructions use the formal imperative without a pronoun ("Introduza o seu email", "Escolha um tema"). Use "o seu/a sua" for possessives.
- **No Brazilian forms:**

  | Not | Use |
  |---|---|
  | tela | ecrã |
  | arquivo | ficheiro |
  | time | equipa |
  | contato | contacto |
  | usuário | utilizador |
  | salvar | guardar |
  | baixar | transferir |
  | senha | palavra-passe |
  | deletar | eliminar |
  | compartilhar | partilhar |
  | cadastro | registo |
  | celular | telemóvel |
  | gerund ("carregando") | "a carregar" |

- **Glossary.** Use these terms consistently across all tasks:

  | English | pt-PT |
  |---|---|
  | Library | Biblioteca |
  | Shelf | Estante |
  | Book | Livro |
  | Work | Obra |
  | Edition | Edição |
  | Author | Autor |
  | Series | Série |
  | Collection | Coleção |
  | Group | Grupo |
  | Genre | Género |
  | Cover | Capa |
  | Synopsis | Sinopse |
  | Rating | Classificação |
  | Reader | Leitor |
  | Want to read | Quero ler |
  | Reading | A ler |
  | Finished | Lido |
  | Home | Início |
  | Search | Pesquisar |
  | Games | Jogos |
  | You (tab) | Perfil |
  | Profile | Perfil |
  | Settings | Definições |
  | Appearance | Aspeto |
  | Theme | Tema |
  | Font | Tipo de letra |
  | Language | Idioma |
  | Automatic (device language) | Automático (idioma do dispositivo) |
  | Sign in | Iniciar sessão |
  | Sign out | Terminar sessão |
  | Create account | Criar conta |
  | Password | Palavra-passe |
  | Username | Nome de utilizador |
  | Email | Email |
  | Account | Conta |
  | Save | Guardar |
  | Cancel | Cancelar |
  | Delete | Eliminar |
  | Edit | Editar |
  | Share | Partilhar |
  | Done | Concluído |
  | Close | Fechar |
  | Back | Voltar |
  | Try again | Tentar novamente |
  | Loading… | A carregar… |
  | Saved | Guardados |
  | Follow | Seguir |
  | Following | A seguir |
  | Followers | Seguidores |
  | Activity | Atividade |
  | Comment | Comentário |
  | Tier list | Tabela de níveis |
  | Tier | Nível |
  | Tournament | Torneio |
  | Vote | Votar |
  | Quiz / quizzes | Quiz / quizzes |
  | Daily Chapter | Capítulo do Dia |
  | Mural | Mural |
  | Reader card | Cartão de leitor |
  | Top Shelf | Estante de Honra |
  | Recap | Resumo |
  | Couldn't X | Não foi possível X |
  | Something went wrong | Algo correu mal |

  The brand "Atmyshelf" is never translated.

- **Times and dates in Portuguese:**
  - Relative times: "agora", "há 5 min", "há 3 h", "há 2 d".
  - Days: "Hoje", "Ontem".
  - Short months: jan fev mar abr mai jun jul ago set out nov dez. `formatDate` in Portuguese gives "3 out 2026".
  - Full months: janeiro … dezembro, lowercase.
- The language names in the picker are always "English" and "Português", whatever the active language.

## Where this plan departs from the spec

Each of these is Claude's call, made after fact-finding:

- **Emails.** Every account email is sent in response to a request, including forgot-password, so emails use that request's language. `users.locale` stores only the reader's pick (`auto`/`en`/`pt-PT`); there is no "last request locale" column.
- **The flag.** It is removed in its own final PR (Task 36), not in the server-errors PR, because Phases 2–4 run in parallel and Portuguese must stay hidden until all three land.
- **Phase 1 screens.** Phase 1 translates only the picker itself. The rest of the settings screen is converted in Task 18. The flag hides Portuguese in production meanwhile.
- **Native permission strings.** These are dropped (see Global Constraints), so no store build is needed.
- **"Automatic" stays English until launch.** Until Task 36, Portuguese appears in dev only for someone who explicitly picks it. That keeps half-converted screens away from everyone's Portuguese devices while the work is in flight.

## Review Focus

1. **Device locale shapes.** An Android device reports `pt_PT`, `pt-BR`, bare `pt` or `en-PT`. The first three give Portuguese and `en-PT` gives English. Pinned in Task 1 (`resolveLocale`) and Task 4 (`deviceLocaleTags`).
2. **Mismatched placeholders.** A Portuguese string whose `{placeholders}` differ from the English one (a typo, or a dropped `{count}`) fails a test in that package. Pinned by `catalogMismatches` in Task 1 and by each package's catalog test (Tasks 3, 4, 5, 31).
3. **Portuguese plurals.** The counts 0, 1, 2 and 1000 give "0 leitores", "1 leitor", "2 leitores", "1000 leitores". Pinned in Task 1 and Task 6 (`readerCountsLabel`).
4. **Background email language.** A forgot-password request from a Portuguese client sends a Portuguese email, even though the email goes out from the background `deliver()` closure. Pinned in Task 32.
5. **Zod default messages.** A zod default validation message on a Portuguese request comes back as Portuguese generic text, never English. An English request is unchanged. Pinned in Task 31.

## The conversion recipe (Tasks 5–35 follow it)

For each file in the task:
1. Move every reader-facing literal into the package's catalog under `<area>.<camelKey>`:
   - JSX text
   - `title`, `placeholder`, `aria-label`, `alt`, `label` and `accessibilityLabel` props
   - toast and error fallbacks
   - object-literal labels
   - tab and stack `title`s
2. Replace the literal with `t("<area>.<key>", vars)`:
   - Inside components, `t` comes from `useT()`.
   - Outside them, it comes from the non-hook `t`.
   - Concatenated English becomes one interpolated message. Never stitch translated fragments.
3. Write the pt-PT entry following the copy rules.
4. Pass the active locale (`useLocale()` / `getLocale()`) to every shared helper that now takes one.

What stays in English:
- strings no reader sees: log lines, analytics names, test ids, CSS, route paths, storage keys
- book data

Further rules:
- **Module-scope labels** (arrays or records of options, tab definitions) store keys and are translated at render. A `t()` call at module scope freezes the language at import.
- **Genre values** shown to readers go through `genreLabel(genre, locale)` (Task 6). The tasks that own genre-rendering files say so.
- **English catalogs** are declared `satisfies Messages`. A type annotation would widen the keys and remove the typecheck guard.
- **Web tests** are `.mts` files and have no JSX. Render with `createElement`, as `frontend/scripts/test-sheet.mts:29` does.

The area's English and Portuguese catalog files are added to the package's catalog index. `typecheck` proves the key sets match. The package's catalog test (`catalogMismatches`) proves the placeholders match.

Existing tests that assert English must keep passing unchanged. Add at least one test per task that renders or calls the converted code with Portuguese and asserts one Portuguese string, so the wiring is proven, not just the catalog.

Every task ends with `node scripts/gate.mjs --plan docs/superpowers/plans/2026-10-31-portuguese-language.md --task <N>` green, then a commit.

Commit messages describe the change. The repo adds no code comments.

---

## Phase 1 — Foundation (PR 1)

### Task 1: Shared i18n core

**Files:**
- Create: `packages/shared/src/i18n/locale.ts`
- Create: `packages/shared/src/i18n/translate.ts`
- Create: `packages/shared/src/i18n/catalogCheck.ts`
- Create: `packages/shared/src/i18n/index.ts`
- Test: `packages/shared/src/i18n/i18n.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

**Interfaces:**
- Produces:
  - `LOCALES = ["en", "pt-PT"] as const`; `type Locale`
  - `LOCALE_PREFERENCES = ["auto", "en", "pt-PT"] as const`; `type LocalePreference`; `parseLocalePreference(value: unknown): LocalePreference` (unknown → `"auto"`)
  - `resolveLocale(preference: LocalePreference | null | undefined, deviceTags: readonly string[]): Locale`
  - `parseAcceptLanguage(header: string | undefined): string[]` (tags ordered by `q`, highest first; malformed parts dropped)
  - `intlLocale(locale: Locale): string | undefined` (`"en"` → `undefined`, `"pt-PT"` → `"pt-PT"`)
  - `type PluralMessage = { one: string; other: string }`; `type Message = string | PluralMessage`; `type Messages = Record<string, Message>`
  - `type CatalogOf<E extends Messages> = { [K in keyof E]: E[K] extends string ? string : PluralMessage }`
  - `type Vars = Record<string, string | number>`; `type Translate<M extends Messages> = (key: Extract<keyof M, string>, vars?: Vars) => string`
  - `createTranslator<M extends Messages>(messages: M): Translate<M>` (plural messages pick by `vars.count === 1`; a missing `count` on a plural message throws)
  - `catalogMismatches(en: Messages, other: Messages): string[]` (one human-readable line per missing key, extra key, string-vs-plural kind difference, or differing `{placeholder}` set; `[]` when clean)
  - Exported from `@scripta/shared` and the new subpath `@scripta/shared/i18n`.

- [ ] **Step 1: Write the failing tests in `i18n.test.ts`**

```ts
test("an explicit pick beats the device", () => {
  assert.equal(resolveLocale("en", ["pt-PT"]), "en");
  assert.equal(resolveLocale("pt-PT", ["en-GB"]), "pt-PT");
});
test("any Portuguese first tag resolves to pt-PT", () => {
  for (const tag of ["pt", "pt-PT", "pt-BR", "pt_PT", "PT-br"]) {
    assert.equal(resolveLocale("auto", [tag]), "pt-PT");
    assert.equal(resolveLocale(null, [tag]), "pt-PT");
  }
});
test("only the first device tag counts and nothing means English", () => {
  assert.equal(resolveLocale("auto", ["en-PT", "pt-PT"]), "en");
  assert.equal(resolveLocale(undefined, []), "en");
});
test("parseAcceptLanguage orders by q", () => {
  assert.deepEqual(parseAcceptLanguage("en;q=0.5, pt-PT"), ["pt-PT", "en"]);
  assert.deepEqual(parseAcceptLanguage(undefined), []);
});
test("createTranslator interpolates and pluralises", () => {
  const t = createTranslator({ greet: "Olá {name}", readers: { one: "{count} leitor", other: "{count} leitores" } });
  assert.equal(t("greet", { name: "Ana" }), "Olá Ana");
  assert.equal(t("readers", { count: 0 }), "0 leitores");
  assert.equal(t("readers", { count: 1 }), "1 leitor");
  assert.equal(t("readers", { count: 2 }), "2 leitores");
  assert.equal(t("readers", { count: 1000 }), "1000 leitores");
  assert.throws(() => t("readers"));
});
test("catalogMismatches finds every kind of drift", () => {
  const en = { a: "Hi {name}", b: { one: "{count} x", other: "{count} xs" }, c: "C" };
  assert.deepEqual(catalogMismatches(en, { a: "Olá {name}", b: { one: "{count} x", other: "{count} xs" }, c: "C" }), []);
  assert.equal(catalogMismatches(en, { a: "Olá {nome}", b: "x", d: "D" }).length, 4);
});
```

- [ ] **Step 2: Run them and see them fail.** Run `npm test --workspace @scripta/shared`. Expected: FAIL, the module is not found.
- [ ] **Step 3: Implement the four files and wire up the exports.** Add `export * from "./i18n/index.js";` to `src/index.ts`. Add the `"./i18n"` subpath to `package.json` `exports`, copying the shape of `"./themes"`.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`. Expected: PASS.
- [ ] **Step 5: Commit**

### Task 2: Locale preference on the account

**Files:**
- Modify: `packages/shared/src/themes/preference.ts`
- Test: `packages/shared/src/themes/themes.test.ts`
- Test: `packages/shared/src/themes/fonts.test.ts`
- Modify: `backend/src/modules/auth/routes.ts`
- Modify: `backend/src/modules/auth/service.ts`
- Modify: `backend/src/modules/auth/domain/ports.ts`
- Modify: `backend/src/modules/auth/domain/types.ts`
- Modify: `backend/src/modules/auth/adapters/sqlite/schema.sql`
- Modify: `backend/src/modules/auth/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/auth/adapters/sqlite/sqliteAuthRepository.ts`
- Test: `backend/src/modules/auth/routes.test.ts`
- Test: `backend/src/modules/auth/adapters/sqlite/sqliteAuthRepository.test.ts`
- Test: `backend/src/modules/auth/service.test.ts`
- Modify: `frontend/src/lib/theme.ts`
- Modify: `mobile/src/features/settings/appearanceSync.ts`

**Interfaces:**
- Consumes: `LOCALE_PREFERENCES`, `LocalePreference`, `parseLocalePreference` (Task 1).
- Produces:
  - `Appearance` gains `locale: LocalePreference`, so `AccountAppearance.locale` is `LocalePreference | null`.
  - `parseAccountAppearance` reads `locale`.
  - `reconcileAppearance` reconciles `locale` exactly like `theme`.
  - `GET /auth/appearance` returns `locale`; `PUT` accepts it.
  - `users.locale TEXT` column.

- [ ] **Step 1: Write the failing tests**
  - **Shared:** `reconcileAppearance` with account `locale: null` uploads the device's `locale`. With account `"pt-PT"` and device `"auto"`, it applies `"pt-PT"`.
  - **`routes.test.ts`** (copy the appearance tests at lines 167–220): `PUT {locale:"pt-PT"}` → 204 and the stub stores it. `PUT {locale:"fr"}` → 400 `{ error: "Unknown appearance." }`.
  - **Repository test:** after `applyAuthMigrations` on an old `users` table, `locale` exists. `setAppearance(id, { locale: "pt-PT" })` round-trips.
- [ ] **Step 2: Run them and see them fail.** Run `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm test --workspace backend`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `locale` beside `theme` in each listed file: the zod schema `locale: z.enum(LOCALE_PREFERENCES)`, the `ALTER TABLE users ADD COLUMN locale TEXT` guard, the column list in the adapter's dynamic `UPDATE`, and the row and port types.
  - Both clients must still compile. `readAppearance()` (`frontend/src/lib/theme.ts:120`) and the `useRef<Appearance>` in `mobile/src/features/settings/appearanceSync.ts:21,24` report `locale: "auto"` for now. Tasks 3 and 4 make them read and apply the real pick.
- [ ] **Step 4: Run the tests and see them pass.** Run `node scripts/gate.mjs --plan docs/superpowers/plans/2026-10-31-portuguese-language.md --task 2`, which covers shared, backend, frontend and mobile typecheck and tests. Expected: PASS.
- [ ] **Step 5: Commit**

### Task 3: Web locale plumbing and picker

**Files:**
- Create: `frontend/src/i18n/flag.ts`
- Create: `frontend/src/i18n/locale.ts`
- Create: `frontend/src/i18n/browser.ts`
- Create: `frontend/src/i18n/index.ts`
- Create: `frontend/src/i18n/messages/en/index.ts`
- Create: `frontend/src/i18n/messages/pt-PT/index.ts`
- Create: `frontend/src/i18n/messages/en/settings.ts`
- Create: `frontend/src/i18n/messages/pt-PT/settings.ts`
- Create: `frontend/src/i18n/messages/en/errors.ts`
- Create: `frontend/src/i18n/messages/pt-PT/errors.ts`
- Create: `frontend/src/components/LanguagePicker.tsx`
- Modify: `frontend/src/pages/SettingsAppearancePage.tsx`
- Modify: `frontend/src/hooks/useAccountAppearanceSync.ts`
- Modify: `frontend/src/lib/theme.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/main.tsx`
- Test: `frontend/scripts/test-i18n.mts`

**Interfaces:**
- Consumes: Task 1 core, Task 2 `Appearance.locale`.
- Produces:
  - `frontend/src/i18n/index.ts` exports:
    - `type WebMessages`
    - `PORTUGUESE_ENABLED`
    - `getLocalePreference(): LocalePreference`
    - `setLocalePreference(p: LocalePreference): void`
    - `setDeviceLocaleTags(tags: readonly string[]): void`
    - `subscribeLocale(listener: () => void): () => void`
    - `getLocale(): Locale`, following the prelaunch rule
    - `useLocale(): Locale`, via `useSyncExternalStore` on `subscribeLocale`
    - `useT(): Translate<WebMessages>`
    - `t(key, vars?)`, a non-hook that uses `getLocale()`
  - `locale.ts` is the pure store.
  - `browser.ts` exports `installBrowserLocale(): void`, called once in `main.tsx` before render. It:
    - reads `localStorage["locale"]`, with access guarded
    - feeds `window.navigator.languages` to the store
    - listens to `languagechange` and cross-tab `storage`
    - persists picks
    - keeps `document.documentElement.lang` in step
  - The catalog index merges the per-area files. Later web tasks add theirs here.

- [ ] **Step 1: Write the failing test `frontend/scripts/test-i18n.mts`**
  - The web catalog has no mismatches: `catalogMismatches(en, ptPT)` → `[]`.
  - `getLocale()` is `"en"` by default.
  - Prelaunch rule: `setDeviceLocaleTags(["pt-PT"])` with pick `"auto"` still gives `"en"`.
  - After `setLocalePreference("pt-PT")`, `t("settings.language")` is `"Idioma"`. Reset to `"auto"` and `[]` afterwards.
  - `renderToStaticMarkup(createElement(LanguagePicker))` contains "English" and "Português".
  - The 429 path: the global `fetch` stubbed to return 429 with `message: "Rate limit exceeded, retry in 2 minutes"` throws `ApiError` with the English text exactly as today. Under pt-PT the message is "Demasiadas tentativas. Aguarde 2 minutos e tente novamente."
- [ ] **Step 2: Run it and see it fail.** Run `npm test --workspace frontend`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Store.** `locale.ts` is the pure store described under Global Constraints. `browser.ts` does every DOM and storage touch.
  - **Sync.** `useAccountAppearanceSync` uploads `getLocalePreference()` as `device.locale` and applies `apply.locale` via `setLocalePreference`. The `Appearance` built in `lib/theme.ts` `readAppearance` gains `locale`.
  - **API client.** `rawFetch` sets `Accept-Language: getLocale()`. Every English literal in `client.ts` moves to `errors.*`. Parse the 429 wait (`(\d+) (second|minute|hour)s?`) into a `{count}` plural per unit, and fall back to "a minute" / "um minuto".
  - **Picker.** `LanguagePicker` offers Automatic / English / Português in the same control style as `ThemePicker`. It renders only when `PORTUGUESE_ENABLED`. `SettingsAppearancePage` renders it under the font pickers.
- [ ] **Step 4: Run the tests and see them pass.** Then verify the flag is off in a production build. Run `npm run build --workspace frontend`. In the browser pane, open the built preview with `localStorage.locale = "pt-PT"`: the page stays English and has no picker. In dev, the picker switches the settings page to Portuguese live and the change survives a reload.
- [ ] **Step 5: Commit**

### Task 4: Mobile locale plumbing and picker

**Files:**
- Create: `mobile/src/i18n/flag.ts`
- Create: `mobile/src/i18n/locale.ts`
- Create: `mobile/src/i18n/native.ts`
- Create: `mobile/src/i18n/index.ts`
- Create: `mobile/src/i18n/messages/en/index.ts`
- Create: `mobile/src/i18n/messages/pt-PT/index.ts`
- Create: `mobile/src/i18n/messages/en/settings.ts`
- Create: `mobile/src/i18n/messages/pt-PT/settings.ts`
- Create: `mobile/src/i18n/messages/en/errors.ts`
- Create: `mobile/src/i18n/messages/pt-PT/errors.ts`
- Create: `mobile/src/features/settings/LanguagePicker.tsx`
- Modify: `mobile/src/features/you/YouScreen.tsx`
- Modify: `mobile/src/features/settings/appearanceSync.ts`
- Modify: `mobile/src/core/apiClient.ts`
- Modify: `mobile/src/core/api.ts`
- Modify: `mobile/src/app/_layout.tsx`
- Test: `mobile/src/i18n/i18n.test.ts`
- Test: `mobile/src/core/apiClient.test.ts`

**Interfaces:**
- Consumes: Task 1 core, Task 2 `Appearance.locale`.
- Produces:
  - The same API as the web `i18n/index.ts`, names identical, from the pure store `locale.ts`. It imports no `react-native` or AsyncStorage, so `node --test` can load it and anything that imports `t`.
  - `native.ts` exports `installNativeLocale(): Promise<void>`. It reads AsyncStorage `"locale"`, feeds `deviceLocaleTags()`, re-reads on `AppState` `active`, and persists picks. It is awaited in the root `_layout.tsx` before the first render, the same way `ThemeProvider` waits on its `multiGet`.
  - `deviceLocaleTags(): string[]` (in `native.ts`) returns `[Intl.DateTimeFormat().resolvedOptions().locale]` with `_` → `-`. It falls back to `I18nManager.getConstants().localeIdentifier` when `Intl` gives nothing.
  - `createApiClient` takes positional arguments (`apiClient.ts:38-44`). It gains a final positional parameter `locale: () => string = () => "en"` after `fetcher`, sent as `Accept-Language`. `core/api.ts` passes `getLocale`.

- [ ] **Step 1: Write the failing tests**
  - The mobile catalog has no mismatches.
  - `getLocale()` is `"en"` by default, and also with device tags `["pt-PT"]` and pick `"auto"` (prelaunch rule).
  - `setLocalePreference("pt-PT")` gives Portuguese `t` output. Reset afterwards.
  - The `apiClient.test.ts` injected fetcher sees `Accept-Language: pt-PT` when `locale` returns `"pt-PT"`.
  - The client-synthesised errors at `apiClient.ts:65,142,151` are unchanged in English.
- [ ] **Step 2: Run them and see them fail.** Run `npm test --workspace mobile`. Expected: FAIL.
- [ ] **Step 3: Implement.** Mirror Task 3. `LanguagePicker` uses the same control as `features/settings/ThemePicker.tsx` and sits under the font pickers in the Appearance sheet (`YouScreen.tsx:73-79`). No new dependency.
- [ ] **Step 4: Run the tests and see them pass.** Then run a device pass via the `device-checker` agent (dev build, Expo Go, system language Português (Portugal)):
  - With "Automático" the app is English (prelaunch rule).
  - Picking "Português" switches the picker's own labels to Portuguese live, and it stays Portuguese after an app restart.
  - Picking "English" returns to English.
  - Log `deviceLocaleTags()` once in dev. Report which `Intl` path gave the tag and that it reads `pt-PT`; Task 36 depends on it.
- [ ] **Step 5: Commit**

### Task 5: Shared strings A — community, home, top shelf, quizzes, auth, themes, dates

**Files:**
- Create: `packages/shared/src/i18n/messages/en.ts`
- Create: `packages/shared/src/i18n/messages/pt-PT.ts`
- Create: `packages/shared/src/i18n/sharedT.ts`
- Modify: `packages/shared/src/i18n/index.ts`
- Modify: `packages/shared/src/community/helpers.ts`
- Modify: `packages/shared/src/community/feedRowModel.ts`
- Modify: `packages/shared/src/community/activityModel.ts`
- Modify: `packages/shared/src/topShelf/api.ts`
- Modify: `packages/shared/src/quizzes/dailyChapter.ts`
- Modify: `packages/shared/src/quizzes/dailyThemes.ts`
- Modify: `packages/shared/src/quizzes/labels.ts`
- Modify: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/themes/palettes.ts`
- Modify: `packages/shared/src/themes/fonts.ts`
- Modify: `packages/shared/src/arena/arenaBracket.ts`
- Modify: `packages/shared/src/arena/countdown.ts`
- Modify: `packages/shared/src/arena/arenaSeed.ts`
- Modify: `packages/shared/src/tierlists/results.ts`
- Modify: `packages/shared/src/dashboard.ts`
- Test: `packages/shared/src/community/helpers.test.ts`
- Test: `packages/shared/src/community/feedRowModel.test.ts`
- Test: `packages/shared/src/community/activityModel.test.ts`
- Test: `packages/shared/src/topShelf/api.test.ts`
- Test: `packages/shared/src/i18n/i18n.test.ts`
- Modify: `packages/shared/src/`
- Modify: `frontend/src/`
- Modify: `mobile/src/`
- Modify: `backend/src/`
- Modify: `frontend/scripts/`

**Interfaces:**
- Consumes: Task 1; client `useLocale`/`getLocale` (Tasks 3, 4).
- Produces:
  - `type SharedMessages`; `sharedT(locale: Locale): Translate<SharedMessages>` (cached per locale).
  - New signatures:
    - `formatDate(iso, locale)`
    - `relativeTime(iso, locale, now?)`
    - `activityDay(iso, locale, now?)`
    - `activityRow(item, locale)`
    - `recapMonthName(month, locale)`
  - Every other text-returning function in the listed modules gains `locale: Locale` by the Global Constraints rule. This includes:
    - the round names "Final", "Semis", "Quarters" and `Round ${n}`
    - the countdown "Closing…" and "3d 4h left"
    - tier-list results text
    - dashboard text
  - Text that isn't a function today becomes one, so `typecheck` finds every reader:
    - `PASSWORD_HINT` → `passwordHint(locale)`, `USERNAME_HINT` → `usernameHint(locale)`, `RECOVERY_MESSAGE` → `recoveryMessage(locale)`. Readers: `LoginPage.tsx`, `AccountActionPage.tsx`, `ChooseUsernamePage.tsx` and `AccountSecuritySection.tsx` on web; `login.tsx`, `forgot-password.tsx` and `account-security.tsx` on mobile; and backend `auth/routes.ts`, which passes `"en"` until Task 32.
    - `label` is removed from the theme and font data in favour of `themeLabel(id, locale)` and `fontLabel(id, locale)`. Readers: `frontend/src/components/ThemeOptionGrid.tsx:17`, `frontend/src/components/FontPicker.tsx:36`, `mobile/src/ui/ThemeGrid.tsx:19` and `mobile/src/features/settings/FontPicker.tsx:40`.
  - Before converting, search every `packages/shared/src` module with `rg` for reader-facing text, leaving out the admin-only review files. Anything found is converted here too, so nothing is left for the parallel phases.

- [ ] **Step 1: Write the failing tests.**
  - The shared catalog has no mismatches.
  - With `TZ = "America/Sao_Paulo"` (set as in `helpers.test.ts:6`), Portuguese:
    - `relativeTime` gives "agora", "há 5 min", "há 3 h" and "há 2 d".
    - `activityDay` gives "Hoje" and "Ontem".
    - `formatDate("2026-10-03", "pt-PT")` is "3 out 2026".
    - `recapMonthName("2026-10", "pt-PT")` is "outubro".
    - `activityRow` labels are Portuguese.
    - The daily-chapter share text is Portuguese.
  - Existing English assertions only gain the `"en"` argument.
- [ ] **Step 2: Run them and see them fail.** Run `npm test --workspace @scripta/shared`.
- [ ] **Step 3: Convert the listed modules by the recipe, with key prefix `shared.<module>`.** Then fix every caller the build and `typecheck` reports in `frontend/src/`, `mobile/src/` and `backend/src/`, passing the active locale (backend: `"en"` until Phase 4). Callers are listed in the foundation report: `relativeTime` ×9, `activityRow` ×3, `recapMonthName` ×6, `formatDate` ×8.
- [ ] **Step 4: Run the tests and see them pass.** Run `node scripts/gate.mjs --plan docs/superpowers/plans/2026-10-31-portuguese-language.md --task 5`, which runs the shared, frontend, mobile and backend suites and typechecks.
- [ ] **Step 5: Commit**

### Task 6: Shared strings B — library, works, murals, reader cards

**Files:**
- Modify: `packages/shared/src/i18n/messages/en.ts`
- Modify: `packages/shared/src/i18n/messages/pt-PT.ts`
- Modify: `packages/shared/src/library/`
- Modify: `packages/shared/src/works/`
- Modify: `packages/shared/src/murals/`
- Modify: `packages/shared/src/readerCards/`
- Modify: `packages/shared/src/plural.ts`
- Modify: `frontend/src/`
- Modify: `mobile/src/`
- Modify: `backend/src/`
- Modify: `frontend/scripts/`

**Interfaces:**
- Consumes: Task 5's `sharedT`.
- Produces:
  - `genreLabel(genre: BookGenre, locale: Locale): string`. Stored genre values are unchanged.
  - `awardLabel` takes a locale.
  - `readerStatusLabel(…, locale)` and `readerCountsLabel(…, locale)`.
  - The mural preset builders take `locale` and write titles in it. The values are frozen once saved.
  - Text helpers in `librarySaver.ts`, `bookCsv.ts`, `goodreads.ts`, `storygraph.ts`, `finish.ts`, `libraryStyle.ts`, `libraryView.ts`, `readerIdentity.ts`, `bookStats.ts`, `bookScreen.ts`, `labels.ts`, `blockKinds.ts`, `savedLooks.ts`, and `readerCards/{labels,pages,plates}.ts` take a locale.
  - The admin-only `works/{genreReview,synopsisReview,translationReview}.ts` are untouched.
  - `plural()` stays until Task 36 for client callers. Shared code stops using it.

- [ ] **Step 1: Write the failing tests.** In Portuguese:
  - `readerCountsLabel` for 0, 1 and 2 gives "0 leitores", "1 leitor" and "2 leitores".
  - `genreLabel("Science Fiction", "pt-PT")` is "Ficção científica". Check the exact key spelling in `bookGenres.ts`.
  - A Portuguese mural preset has a Portuguese title.
  - `formatFinishDay(day, locale?: string)` already takes an `Intl` locale, and its English tests pin `"en-US"`. Keep its signature and tests; its callers pass `intlLocale(locale)`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Convert by the recipe and fix every caller in both clients.**
- [ ] **Step 4: Run the gate for task 6.** Expected: PASS.
- [ ] **Step 5: Commit.** Open PR 1 (Tasks 1–6) per the `ship` skill.

---

## Phase 2 — Web screens (PR 2, after PR 1 merges)

Each task: apply the recipe to the listed files, add the area's catalog pair, and pass the gate.
- **Files:** every task also lists `frontend/src/i18n/messages/en/<area>.ts` + `frontend/src/i18n/messages/pt-PT/<area>.ts` (Create) and both catalog `index.ts` files (Modify).
- **Tests:** each task adds its Portuguese test to an existing `frontend/scripts/test-*.mts` for that area, or to a new `frontend/scripts/test-i18n-<area>.mts`.

### Task 7: Web shell, navigation, auth (`shell`)

**Files:**
- Create: `frontend/src/i18n/messages/en/shell.ts`
- Create: `frontend/src/i18n/messages/pt-PT/shell.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/layouts/`
- Modify: `frontend/src/components/page/`
- Modify: `frontend/src/auth/`
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/pages/AccountActionPage.tsx`
- Modify: `frontend/src/pages/ChooseUsernamePage.tsx`
- Modify: `frontend/src/pages/WelcomeAvatarPage.tsx`
- Modify: `frontend/src/pages/OAuthSuccessPage.tsx`
- Modify: `frontend/src/pages/NotFoundPage.tsx`
- Modify: `frontend/src/pages/PrivacyPage.tsx`
- Modify: `frontend/src/lib/areas.ts`
- Modify: `frontend/src/components/Toaster.tsx`
- Modify: `frontend/src/components/ConfirmDialog.tsx`
- Modify: `frontend/src/components/Sheet.tsx`
- Modify: `frontend/src/components/EmptyState.tsx`
- Modify: `frontend/src/components/OfflineBanner.tsx`
- Modify: `frontend/src/components/OptionsMenu.tsx`
- Modify: `frontend/src/components/SaveStatus.tsx`
- Modify: `frontend/src/components/NavIcons.tsx`
- Modify: `frontend/src/components/Skeleton.tsx`
- Modify: `frontend/src/components/Toolbar.tsx`
- Test: `frontend/scripts/`

Notes:
- `areas.ts` labels become keys resolved at render.
- The "Admin" area stays English.
- `PrivacyPage.tsx`: only the chrome is converted, not the policy body.
- Test: the login page renders "Iniciar sessão" under pt-PT.

- [ ] Step 1: failing Portuguese test · Step 2: see it fail · Step 3: convert · Step 4: gate green · Step 5: commit

### Task 8: Web library browse (`library`)

**Files:**
- Create: `frontend/src/i18n/messages/en/library.ts`
- Create: `frontend/src/i18n/messages/pt-PT/library.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/src/pages/GroupsPage.tsx`
- Modify: `frontend/src/pages/SeriesPage.tsx`
- Modify: `frontend/src/pages/CollectionsPage.tsx`
- Modify: `frontend/src/pages/SavedPage.tsx`
- Modify: `frontend/src/pages/GalleryPage.tsx`
- Modify: `frontend/src/pages/SharedLibraryPage.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/components/BookCard.tsx`
- Modify: `frontend/src/components/BookGrid.tsx`
- Modify: `frontend/src/components/BookSummary.tsx`
- Modify: `frontend/src/components/LibraryToolbar.tsx`
- Modify: `frontend/src/components/LibraryCanvas.tsx`
- Modify: `frontend/src/components/DuplicatesSheet.tsx`
- Modify: `frontend/src/components/ProfileLibraryPanel.tsx`
- Modify: `frontend/src/components/PublicLibraryGrid.tsx`
- Modify: `frontend/src/components/SwipeTabs.tsx`
- Modify: `frontend/src/lib/libraryView.ts`
- Modify: `frontend/src/lib/groups.ts`
- Test: `frontend/scripts/`

- [ ] Steps 1–5 as Task 7

### Task 9: Web add, import, finish, covers, share (`addBook`)

**Files:**
- Create: `frontend/src/i18n/messages/en/addBook.ts`
- Create: `frontend/src/i18n/messages/pt-PT/addBook.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/components/AddBookModal.tsx`
- Modify: `frontend/src/components/AddBookSheet.tsx`
- Modify: `frontend/src/components/FinishSheet.tsx`
- Modify: `frontend/src/components/FeelingChips.tsx`
- Modify: `frontend/src/components/SyncGoodreadsModal.tsx`
- Modify: `frontend/src/components/CoverPickerModal.tsx`
- Modify: `frontend/src/components/FoundCovers.tsx`
- Modify: `frontend/src/components/ShareModal.tsx`
- Modify: `frontend/src/components/ShareLinkRow.tsx`
- Modify: `frontend/src/hooks/`
- Modify: `frontend/src/lib/fileImport.ts`
- Modify: `frontend/src/lib/shareLink.ts`
- Modify: `frontend/src/lib/bookMetadata.ts`
- Test: `frontend/scripts/`

The `isAdmin` block in `FoundCovers.tsx` stays English. The genre chips in `AddBookModal.tsx` use `genreLabel`.

- [ ] Steps 1–5 as Task 7

### Task 10: Web home and book/work pages (`book`)

**Files:**
- Create: `frontend/src/i18n/messages/en/book.ts`
- Create: `frontend/src/i18n/messages/pt-PT/book.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/HomePage.tsx`
- Modify: `frontend/src/pages/WorkPage.tsx`
- Modify: `frontend/src/pages/WorkStatsPage.tsx`
- Modify: `frontend/src/pages/BookKeyPage.tsx`
- Modify: `frontend/src/components/home/`
- Modify: `frontend/src/components/book/`
- Modify: `frontend/src/components/dailyChapter/`
- Modify: `frontend/src/lib/homeGames.ts`
- Test: `frontend/scripts/`

Genres in `components/book/BookScreen.tsx` and `pages/HomePage.tsx` use `genreLabel`.

- [ ] Steps 1–5 as Task 7

### Task 11: Web community and profile (`community`)

**Files:**
- Create: `frontend/src/i18n/messages/en/community.ts`
- Create: `frontend/src/i18n/messages/pt-PT/community.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/DiscoverPage.tsx`
- Modify: `frontend/src/pages/PeoplePage.tsx`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/components/ProfileActivity.tsx`
- Modify: `frontend/src/components/SocialsSection.tsx`
- Modify: `frontend/src/components/Avatar.tsx`
- Modify: `frontend/src/components/CommunityAuthorAvatar.tsx`
- Test: `frontend/scripts/`

- [ ] Steps 1–5 as Task 7

### Task 12: Web tournaments and character game (`arena`)

**Files:**
- Create: `frontend/src/i18n/messages/en/arena.ts`
- Create: `frontend/src/i18n/messages/pt-PT/arena.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/ArenaListPage.tsx`
- Modify: `frontend/src/pages/ArenaSeedPage.tsx`
- Modify: `frontend/src/pages/ArenaViewPage.tsx`
- Modify: `frontend/src/pages/CharacterGamePage.tsx`
- Modify: `frontend/src/components/arena/`
- Modify: `frontend/src/components/games/`
- Modify: `frontend/src/components/DuelButton.tsx`
- Modify: `frontend/src/components/CharacterHeader.tsx`
- Modify: `frontend/src/lib/arenaSeed.ts`
- Test: `frontend/scripts/`

- [ ] Steps 1–5 as Task 7

### Task 13: Web tier lists (`tierlists`)

**Files:**
- Create: `frontend/src/i18n/messages/en/tierlists.ts`
- Create: `frontend/src/i18n/messages/pt-PT/tierlists.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/TierListCreatePage.tsx`
- Modify: `frontend/src/pages/TierListEditorPage.tsx`
- Modify: `frontend/src/pages/VoteTierlistPage.tsx`
- Modify: `frontend/src/components/tierlist/`
- Modify: `frontend/src/lib/tierlistResults.ts`
- Test: `frontend/scripts/`

"Untitled tier list" and "New tier" are written in the creator's locale.

- [ ] Steps 1–5 as Task 7

### Task 14: Web quizzes and Daily Chapter (`quizzes`)

**Files:**
- Create: `frontend/src/i18n/messages/en/quizzes.ts`
- Create: `frontend/src/i18n/messages/pt-PT/quizzes.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/QuizCreatePage.tsx`
- Modify: `frontend/src/pages/QuizEditorPage.tsx`
- Modify: `frontend/src/pages/PlayQuizPage.tsx`
- Modify: `frontend/src/pages/DailyChapterPage.tsx`
- Modify: `frontend/src/components/quiz/`
- Modify: `frontend/src/components/quizzes/`
- Modify: `frontend/src/lib/quizTypeLabels.ts`
- Modify: `frontend/src/lib/quizPlayStage.ts`
- Test: `frontend/scripts/`

- [ ] Steps 1–5 as Task 7

### Task 15: Web murals list and shared mural (`murals`)

**Files:**
- Create: `frontend/src/i18n/messages/en/murals.ts`
- Create: `frontend/src/i18n/messages/pt-PT/murals.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/MuralsListPage.tsx`
- Modify: `frontend/src/pages/SharedMuralPage.tsx`
- Modify: `frontend/src/lib/sharedMural.ts`
- Modify: `frontend/src/lib/muralFolders.ts`
- Modify: `frontend/src/lib/muralPresets.ts`
- Test: `frontend/scripts/`

- [ ] Steps 1–5 as Task 7

### Task 16: Web mural editor (`muralEditor`)

**Files:**
- Create: `frontend/src/i18n/messages/en/muralEditor.ts`
- Create: `frontend/src/i18n/messages/pt-PT/muralEditor.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/MuralEditorPage.tsx`
- Modify: `frontend/src/components/murals/`
- Modify: `frontend/src/lib/muralStats.ts`
- Test: `frontend/scripts/`

Genres in `components/murals/AddBlockMenu.tsx`, `BlockConfigPanel.tsx`, `MobileBlockPreview.tsx` and `blocks/MiscBlocks.tsx` use `genreLabel`.

- [ ] Steps 1–5 as Task 7

### Task 17: Web reader card (`readerCard`)

**Files:**
- Create: `frontend/src/i18n/messages/en/readerCard.ts`
- Create: `frontend/src/i18n/messages/pt-PT/readerCard.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/ReaderCardPage.tsx`
- Modify: `frontend/src/components/readerCard/`
- Test: `frontend/scripts/`

- [ ] Steps 1–5 as Task 7

### Task 18: Web settings and library style (`settings`)

**Files:**
- Modify: `frontend/src/i18n/messages/en/settings.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/settings.ts`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/pages/SettingsAppearancePage.tsx`
- Modify: `frontend/src/pages/LibraryStylePage.tsx`
- Modify: `frontend/src/components/StyleControls.tsx`
- Modify: `frontend/src/components/PerCardStylePanel.tsx`
- Modify: `frontend/src/components/FontPicker.tsx`
- Modify: `frontend/src/components/ThemePicker.tsx`
- Modify: `frontend/src/components/ThemeOptionGrid.tsx`
- Modify: `frontend/src/components/ToggleSwitch.tsx`
- Modify: `frontend/src/lib/libraryStyle.ts`
- Test: `frontend/scripts/`

- [ ] Steps 1–5 as Task 7

### Task 19: Web landing and public pages (`landing`)

**Files:**
- Create: `frontend/src/i18n/messages/en/landing.ts`
- Create: `frontend/src/i18n/messages/pt-PT/landing.ts`
- Modify: `frontend/src/i18n/messages/en/index.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/index.ts`
- Modify: `frontend/src/pages/LandingPage.tsx`
- Modify: `frontend/src/components/landing/`
- Modify: `frontend/src/lib/landing.ts`
- Modify: `frontend/src/components/BrandLockup.tsx`
- Test: `frontend/scripts/`

`components/landing/books.ts` is book data and stays as is.

- [ ] Steps 1–5 as Task 7, then open PR 2.

---

## Phase 3 — Mobile screens (PR 3, after PR 1 merges; can run alongside Phases 2 and 4)

Each task: apply the recipe, add the area's catalog pair under `mobile/src/i18n/messages/{en,pt-PT}/<area>.ts`, and pass the gate.
- **Tests:** mobile tests are model tests. The Portuguese test calls a converted model/helper, or `t` with the pt catalog, for one string the screen shows.
- **Tab and stack titles** in `_layout.tsx` files use `useT()` inside the layout component.

### Task 20: Mobile shell, auth, You, settings (`shell`)

**Files:**
- Create: `mobile/src/i18n/messages/en/shell.ts`
- Create: `mobile/src/i18n/messages/pt-PT/shell.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/i18n/messages/en/settings.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/settings.ts`
- Modify: `mobile/src/app/_layout.tsx`
- Modify: `mobile/src/app/(app)/`
- Modify: `mobile/src/app/(public)/login.tsx`
- Modify: `mobile/src/app/forgot-password.tsx`
- Modify: `mobile/src/app/choose-username.tsx`
- Modify: `mobile/src/app/welcome-avatar.tsx`
- Modify: `mobile/src/app/account-security.tsx`
- Modify: `mobile/src/app/oauth-success.tsx`
- Modify: `mobile/src/app/+not-found.tsx`
- Modify: `mobile/src/core/`
- Modify: `mobile/src/ui/`
- Modify: `mobile/src/features/auth/`
- Modify: `mobile/src/features/settings/`
- Modify: `mobile/src/features/you/`
- Test: `mobile/src/i18n/i18n.test.ts`

- [ ] Steps 1–5 as Task 7

### Task 21: Mobile library core (`library`)

**Files:**
- Create: `mobile/src/i18n/messages/en/library.ts`
- Create: `mobile/src/i18n/messages/pt-PT/library.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/library/`
- Test: `mobile/src/features/library/`

Everything in `features/library/` except `components/AddBookForm.tsx` and `components/GenreChoices.tsx`, which are Task 22. Genres in `components/LibraryShareImage.tsx` use `genreLabel`.

- [ ] Steps 1–5 as Task 7

### Task 22: Mobile add book, import, gallery (`addBook`)

**Files:**
- Create: `mobile/src/i18n/messages/en/addBook.ts`
- Create: `mobile/src/i18n/messages/pt-PT/addBook.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/library/components/AddBookForm.tsx`
- Modify: `mobile/src/features/library/components/GenreChoices.tsx`
- Modify: `mobile/src/features/import/`
- Modify: `mobile/src/features/gallery/`
- Modify: `mobile/src/app/gallery.tsx`
- Test: `mobile/src/features/import/`

The `__DEV__` UI gallery route stays English. Genre choices use `genreLabel`.

- [ ] Steps 1–5 as Task 7

### Task 23: Mobile search and book/work (`book`)

**Files:**
- Create: `mobile/src/i18n/messages/en/book.ts`
- Create: `mobile/src/i18n/messages/pt-PT/book.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/search/`
- Modify: `mobile/src/features/works/`
- Modify: `mobile/src/features/characters/`
- Modify: `mobile/src/features/awards/`
- Modify: `mobile/src/app/(public)/book/`
- Modify: `mobile/src/app/(public)/work/`
- Test: `mobile/src/features/works/`

Genres in `features/works/BookScreen.tsx` use `genreLabel`.

- [ ] Steps 1–5 as Task 7

### Task 24: Mobile home and community (`community`)

**Files:**
- Create: `mobile/src/i18n/messages/en/community.ts`
- Create: `mobile/src/i18n/messages/pt-PT/community.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/home/`
- Modify: `mobile/src/features/community/`
- Modify: `mobile/src/app/dashboard/`
- Test: `mobile/src/features/community/`

- [ ] Steps 1–5 as Task 7

### Task 25: Mobile sharing, socials, public, Top Shelf (`sharing`)

**Files:**
- Create: `mobile/src/i18n/messages/en/sharing.ts`
- Create: `mobile/src/i18n/messages/pt-PT/sharing.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/sharing/`
- Modify: `mobile/src/features/socials/`
- Modify: `mobile/src/features/public/`
- Modify: `mobile/src/features/topShelf/`
- Modify: `mobile/src/app/recap/`
- Modify: `mobile/src/app/shared/`
- Test: `mobile/src/features/topShelf/`

`recapModel.ts` and `topShelfModel.ts` move off `plural()` onto catalog plurals. Genres in `topShelfModel.ts`, `TopShelfScreen.tsx`, `TopShelfBar.tsx` and `LeaderboardScreen.tsx` use `genreLabel`.

- [ ] Steps 1–5 as Task 7

### Task 26: Mobile tournaments (`arena`)

**Files:**
- Create: `mobile/src/i18n/messages/en/arena.ts`
- Create: `mobile/src/i18n/messages/pt-PT/arena.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/arena/`
- Modify: `mobile/src/app/arena/`
- Test: `mobile/src/features/arena/`

- [ ] Steps 1–5 as Task 7

### Task 27: Mobile tier lists (`tierlists`)

**Files:**
- Create: `mobile/src/i18n/messages/en/tierlists.ts`
- Create: `mobile/src/i18n/messages/pt-PT/tierlists.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/tierlists/`
- Modify: `mobile/src/app/play/`
- Modify: `mobile/src/app/vote/`
- Test: `mobile/src/features/tierlists/`

Saved defaults are written in the creator's locale. `TierlistShareImage.tsx:36` passes `intlLocale(locale)`.

- [ ] Steps 1–5 as Task 7

### Task 28: Mobile quizzes and Daily Chapter (`quizzes`)

**Files:**
- Create: `mobile/src/i18n/messages/en/quizzes.ts`
- Create: `mobile/src/i18n/messages/pt-PT/quizzes.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/quizzes/`
- Modify: `mobile/src/features/dailyChapter/`
- Modify: `mobile/src/app/daily.tsx`
- Modify: `mobile/src/app/(public)/daily-chapters/`
- Test: `mobile/src/features/quizzes/`

- [ ] Steps 1–5 as Task 7

### Task 29: Mobile murals (`murals`)

**Files:**
- Create: `mobile/src/i18n/messages/en/murals.ts`
- Create: `mobile/src/i18n/messages/pt-PT/murals.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/murals/`
- Test: `mobile/src/features/murals/`

Genres in `MuralCanvas.tsx` use `genreLabel`.

- [ ] Steps 1–5 as Task 7

### Task 30: Mobile reader card (`readerCard`)

**Files:**
- Create: `mobile/src/i18n/messages/en/readerCard.ts`
- Create: `mobile/src/i18n/messages/pt-PT/readerCard.ts`
- Modify: `mobile/src/i18n/messages/en/index.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/index.ts`
- Modify: `mobile/src/features/readerCard/`
- Modify: `mobile/src/app/reader-card.tsx`
- Test: `mobile/src/features/readerCard/`

- [ ] Steps 1–5 as Task 7. Then run a `device-checker` pass in Portuguese over one screen per mobile area. Open PR 3.

---

## Phase 4 — Server errors and emails (PR 4, after PR 1 merges; can run alongside Phases 2 and 3)

### Task 31: Backend i18n core

**Files:**
- Create: `backend/src/i18n/index.ts`
- Create: `backend/src/i18n/messages/en.ts`
- Create: `backend/src/i18n/messages/pt-PT.ts`
- Test: `backend/src/i18n/i18n.test.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: Task 1 (`parseAcceptLanguage`, `resolveLocale`, `createTranslator`, `catalogMismatches`).
- Produces:
  - `t(locale: Locale, key: BackendKey, vars?: Vars): string`.
  - `localeOf(request: FastifyRequest): Locale`, computed as `resolveLocale(null, parseAcceptLanguage(request.headers["accept-language"]))`. It is a pure function with no hook or decoration, so standalone test harnesses work.
  - `class LocalizedError extends Error { constructor(readonly key: BackendKey, readonly vars?: Vars) }`. Its `message` is `t("en", key, vars)`, so logs and existing `.message` assertions are unchanged.
  - `validationMessage(locale: Locale, error: ZodError): string`:
    - If the first issue's message is a catalog key, translate it.
    - Else, for `"en"`, return it as today (`?? "Invalid request."`).
    - Else, return `t(locale, "common.invalidRequest")`.
  - `app.ts`'s error handler translates `"Internal server error"` and, for pt-PT only, sends a generic `common.requestFailed` instead of the HTTP status text.

- [ ] **Step 1: Write the failing tests**
  - The backend catalog has no mismatches.
  - `localeOf` returns `en` without a header, `pt-PT` for `pt-BR,en;q=0.5`, and `en` for `en-PT`.
  - `validationMessage("pt-PT", <zod default error>)` gives Portuguese. `validationMessage("en", …)` gives the zod default unchanged.
  - A Fastify inject on a bad-JSON route with `Accept-Language: pt-PT` returns a Portuguese `error`.
  - Add the new test file to `backend/package.json` `test`.
- [ ] **Step 2: Run them and see them fail.** Run `npm test --workspace backend`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the gate for task 31.** Expected: PASS.
- [ ] **Step 5: Commit**

### Task 32: Auth errors and every account email

**Files:**
- Modify: `backend/src/i18n/messages/en.ts`
- Modify: `backend/src/i18n/messages/pt-PT.ts`
- Modify: `backend/src/modules/auth/`
- Modify: `backend/src/modules/waitlist/`
- Test: `backend/src/modules/auth/accountSecurity.test.ts`
- Test: `backend/src/modules/auth/emailLayout.test.ts`
- Test: `backend/src/modules/auth/routes.test.ts`
- Test: `backend/src/modules/waitlist/plugin.test.ts`
- Modify: `docs/emails.md`

**Interfaces:**
- Produces:
  - `renderEmail(content, siteUrl, locale)`. It sets `<html lang>` and translates "Or paste this link…" and the footer.
  - Every `createAccountSecurity` method that sends mail takes a trailing `locale: Locale`.
  - `confirmationEmail(email, siteUrl, locale)` and `confirmationSubject(locale)`.
  - Routes compute `localeOf(request)` **before** the `deliver(() => …)` closure.
  - The auth `domain/errors.ts` classes extend `LocalizedError`. The auth plugin's error handler (`routes.ts:287-293`) sends `t(localeOf(request), error.key, error.vars)`.

- [ ] **Step 1: Write the failing tests**
  - `POST /auth/forgot-password` with `Accept-Language: pt-PT` records a Portuguese subject and body.
  - Each of the 6 account emails and the waitlist email has a Portuguese rendering test.
  - Sign-in with a wrong password under pt-PT returns a Portuguese error. English is unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement by the recipe.** Update `docs/emails.md` to say emails follow the request's language.
- [ ] **Step 4: Run the gate for task 32.**
- [ ] **Step 5: Commit**

### Task 33: Community, socials and arena errors

**Files:**
- Modify: `backend/src/i18n/messages/en.ts`
- Modify: `backend/src/i18n/messages/pt-PT.ts`
- Modify: `backend/src/modules/community/`
- Modify: `backend/src/modules/socials/`
- Modify: `backend/src/modules/arena/`
- Test: `backend/src/modules/community/`
- Test: `backend/src/modules/socials/`
- Test: `backend/src/modules/arena/`
- Modify: `backend/package.json`

Domain errors extend `LocalizedError`. Route literals use `t(localeOf(request), …)`. `issues[0]?.message` sites use `validationMessage`. The follow-limit number is formatted per locale. Test: one Portuguese error per module.

- [ ] Steps 1–5 as Task 31

### Task 34: Tier list, mural and gallery errors

**Files:**
- Modify: `backend/src/i18n/messages/en.ts`
- Modify: `backend/src/i18n/messages/pt-PT.ts`
- Modify: `backend/src/modules/tierlists/`
- Modify: `backend/src/modules/murals/`
- Modify: `backend/src/modules/gallery/`
- Test: `backend/src/modules/tierlists/`
- Test: `backend/src/modules/murals/`
- Test: `backend/src/modules/gallery/`
- Modify: `backend/package.json`

- [ ] Steps 1–5 as Task 33

### Task 35: Library, books, works and quizzes errors

**Files:**
- Modify: `backend/src/i18n/messages/en.ts`
- Modify: `backend/src/i18n/messages/pt-PT.ts`
- Modify: `backend/src/modules/library/`
- Modify: `backend/src/modules/books/`
- Modify: `backend/src/modules/works/`
- Modify: `backend/src/modules/quizzes/`
- Modify: `backend/src/worksErrors.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/library/`
- Test: `backend/src/modules/books/`
- Test: `backend/src/modules/works/`
- Test: `backend/src/modules/quizzes/`
- Modify: `backend/package.json`

Admin routes in `books` and the editor-only Daily Chapter files stay English. `WorkResolutionError` is translated in `app.ts`.

- [ ] Steps 1–5 as Task 33, then open PR 4.

---

## Phase 5 — Launch (PR 5, after PRs 2, 3 and 4 merge)

### Task 36: Remove the flag and sweep

**Files:**
- Delete: `frontend/src/i18n/flag.ts`
- Delete: `mobile/src/i18n/flag.ts`
- Modify: `packages/shared/src/i18n/messages/en.ts`
- Modify: `packages/shared/src/i18n/messages/pt-PT.ts`
- Modify: `frontend/src/i18n/locale.ts`
- Modify: `frontend/src/i18n/index.ts`
- Modify: `frontend/src/components/LanguagePicker.tsx`
- Modify: `mobile/src/i18n/locale.ts`
- Modify: `mobile/src/i18n/index.ts`
- Modify: `mobile/src/features/settings/LanguagePicker.tsx`
- Delete: `packages/shared/src/plural.ts`
- Delete: `packages/shared/src/plural.test.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `frontend/scripts/test-i18n.mts`
- Test: `mobile/src/i18n/i18n.test.ts`

- [ ] **Step 1: Change the tests to the launch behaviour, on both clients:**
  - With pick `"auto"`, `setDeviceLocaleTags(["pt-PT"])` now gives `"pt-PT"`, and `["en-PT"]` gives `"en"`.
  - With no device tags set, as in every other test, the result is still `"en"`.
- [ ] **Step 2: Remove the flag.**
  - Replace the prelaunch rule with `resolveLocale(pick, deviceTags)`.
  - Convert any shared strings the Phase 2–4 PR descriptions listed as missing.
  - Delete `plural.ts` if `rg "plural\("` finds no callers. Otherwise convert the stragglers first.
- [ ] **Step 3: Sweep.**
  - Rerun the inventory heuristic (JSX text and copy props outside `i18n/messages`) over `frontend/src` and `mobile/src`, excluding the out-of-scope files. Every hit is either converted or recorded as deliberate in the PR description.
  - **Web:** walk every area in Portuguese in the browser pane at 1280px and 360px. Look for clipped or overflowing Portuguese text, which runs ~20% longer.
  - **Mobile:** run a `device-checker` pass with the system in Português over one screen per area. The Android one-line Text under-measure (see memory) is a known trap for longer labels.
- [ ] **Step 4: Run the gate for task 36.**
- [ ] **Step 5: Commit and open PR 5.** Hand the user the Portuguese catalog files to review before the deploy.
