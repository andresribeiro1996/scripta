# European Portuguese (pt-PT) in Scripta

## Why

Scripta is English-only. Older Portuguese readers who don't read English are more comfortable in their own language, and one English word on a button they need can stop them. They use both the phone app and the website.

Success: a Portuguese reader opens either client and never meets English in the interface — not on a button, an error, a date, or an email.

## Goals

- Every interface string on the web (`frontend/`) and mobile (`mobile/`) clients, and in `@scripta/shared`, exists in English and European Portuguese.
- The language is chosen automatically and can be changed later.
- Server error messages that the clients show verbatim arrive in the reader's language.
- The 8 account emails (`docs/emails.md`) and the waitlist confirmation go out in the reader's language.
- Dates, relative times ("há 5 min"), month names, counts and plurals follow Portuguese rules in Portuguese.
- Genre names (`BOOK_GENRES`) and award names display in Portuguese; stored values stay the English keys.

## Non-goals

- Book data: titles, authors, synopses, series names. Most of the catalog is already Portuguese (BNP import); nothing is machine-translated.
- Daily Chapter editorial content (editions, passages, explanations) stays as written. Its UI chrome is translated.
- The privacy page (`frontend/src/pages/PrivacyPage.tsx`) stays English for now (user's decision: it's a legal text). Its page chrome — header, navigation — is translated like any other page.
- Brazilian Portuguese as a separate variant. Any Portuguese device locale (`pt`, `pt-PT`, `pt-BR`, …) gets pt-PT.
- Languages beyond English and pt-PT. The design must not prevent a third, but nothing is built for one.
- Admin and editor surfaces (Claude's call — only the user uses them, in English):
  - the `Admin*Page.tsx` pages
  - the backend admin console
  - editor-only Daily Chapter validation errors
  - operator alert emails to `ALERT_EMAIL` (the ISBNdb and TypeSafe alerts)

  The completeness guard covers reader-facing code only, and the plan names that boundary explicitly.

## Anti-goals

- A half-translated screen. A Portuguese reader seeing English mixed into a translated screen is worse than today, because it looks broken.
- Brazilian vocabulary or spelling (e.g. "tela", "arquivo", "time", "contato"), or Google-Translate stiffness. It must read like a Portuguese app.
- "Tu". Use "você" or, preferably, impersonal forms ("Guardar", "Iniciar sessão", "Não foi possível guardar"). Older readers may find "tu" overly familiar.
- Existing English copy changing as a side effect. English stays word-for-word as it is today.

## How the language is chosen (decided)

1. If the reader has picked a language, that wins, on every device (it's saved to the account).
2. Otherwise the device or browser language: any `pt*` → pt-PT, anything else → English.
3. Signed-out screens (landing, login, sign-up, public share links) use the device language, or the last pick stored locally on that device.

The picker lives in settings beside Appearance on both clients (web `frontend/src/pages/SettingsAppearancePage.tsx`, mobile Appearance sheet in `mobile/src/features/you/YouScreen.tsx`). It offers "Automatic (device language)", "English", "Português". The language names are always written in their own language.

The choice syncs to the account the way appearance does today (`GET/PUT /auth/appearance`, `mobile/src/features/settings/appearanceSync.ts`), so changing it on the phone changes it on the web.

## How it's built (Claude's calls; the builder may revisit them with a reason)

- **No i18n library.** A small core in `@scripta/shared` has these parts:
  - the locale type `"en" | "pt-PT"`
  - device-locale resolution
  - a `t()` with `{name}` interpolation
  - plural selection via `Intl.PluralRules`
  - date and relative-time helpers that take a locale

  Catalogs are plain TypeScript objects. The Portuguese catalog is typed against the English one, so a missing or misspelt key fails `typecheck`; this is the guard against half-translated screens.
- **Catalogs.**
  - Shared strings live in `@scripta/shared`.
  - Each client owns its own screen strings.
  - The backend owns error and email strings.
  - Organise files by area so a reviewer can read one area at a time.
- **Server errors are translated on the server.**
  - Both API clients send the active locale on every request (`Accept-Language`).
  - The backend resolves it per request and translates its `error` text from a backend catalog.
  - Client-synthesised errors (e.g. `frontend/src/api/client.ts:40`, `mobile/src/core/apiClient.ts:65,142`) and UI fallbacks ("Couldn't …") go through the client catalogs.
- **Emails.**
  - `users` gets a `locale` column. It is the reader's pick, or else the locale of their most recent authenticated request.
  - Emails sent in response to a request use that request's locale.
  - The waitlist confirmation uses the signup request's locale.
  - `emailLayout.ts` sets `<html lang>` accordingly.
- **Web.** Set `document.documentElement.lang` at runtime. `index.html` meta and the PWA manifest may stay English: they're what search engines and install prompts read, and no reader sits on them.
- **Mobile.**
  - Detect the device locale without adding a native module if the runtime allows it (check `Intl` on Hermes on a device first). A new native module changes the runtime and needs a store build.
  - Translating the native permission strings (`mobile/app.json:89,113`) is in scope if it can be done through Expo config. It will need a store build; the user decides when that build happens (EAS Free plan).
- **Tests.** Tests run in English by default, so existing English assertions stay valid. New tests cover:
  - locale resolution
  - catalog completeness (also enforced by types)
  - Portuguese plurals and dates
  - the `Accept-Language` round trip
  - one email per language

  Date tests follow the repo's west-of-UTC TZ rule.

## Delivery (Claude's call)

Several PRs, each mergeable on its own and each leaving English unchanged:

1. **Foundation.**
   - the shared core
   - the locale column and appearance-style sync
   - `Accept-Language` on both clients
   - the picker on both clients
   - shared strings, dates and plurals

   Portuguese becomes reachable here, so this PR also translates the screens the picker sits on, and the picker stays behind a dev-only flag until step 4 lands.
2. **Web screens.**
3. **Mobile screens.**
4. **Server errors and emails.** Then remove the flag.

Steps 2–4 can run in parallel once step 1 is merged. Nothing is deployed until all four are merged; the deploy goes into the user's usual batched runbook.

## Text saved into user data (Claude's call)

Default text that gets saved and then becomes the user's own is written in the creator's language at the moment of creation, then frozen. This covers:
- mural preset titles (`packages/shared/src/murals/presets.ts`)
- "Untitled tier list" and "New tier"

Existing saved English defaults are left as they are. There is no migration and no render-from-role.

## Who writes and reviews the Portuguese

Claude writes the pt-PT text. The user reads it before it goes live, not before merge (Claude's call):
- PRs keep auto-merge as usual.
- The dev flag keeps Portuguese unreachable in production until step 4.
- The user reviews the Portuguese catalog diffs, area by area, before the batched deploy.
- Strings they flag are fixed in a follow-up PR.

## Left to the builder

- Exact key naming and file layout of the catalogs.
- How `t()` is exposed in React (context/hook) on each client, and how the locale reaches shared helpers that format text.
- Whether a few strings that differ only by platform share a key.
- The order screens are converted within steps 2 and 3.
