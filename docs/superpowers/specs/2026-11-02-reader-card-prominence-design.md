# Reader card prominence

Date: 2026-11-02. Scope: `mobile/`, `frontend/`, `backend/`, and `@scripta/shared` where logic is shared.

## Why

The reader card is hard to find. The user named three problems:

1. Your own card is hard to reach.
2. Another reader's card is hard to see.
3. Your own card can't be shared.

The cause is the same for all three. Outside the editor, the card exists only as a `readerCard` mural block (`packages/shared/src/murals/blockKinds.ts:148`). It shows only if the owner put that block on their mural. The "My shelf" preset adds it only once the card is Settled (`packages/shared/src/murals/presets.ts:93-100`). So the card has no fixed place, and for many readers it doesn't appear at all. Getting to someone else's card takes about four taps: Search → profile → Mural → tap the block. Nothing shares the card on its own (`docs/superpowers/specs/2026-10-07-reader-card-enrichment-design.md:388-405`, sub-projects B, C and D, none built).

The picture the user has in mind: **someone opens my profile and sees my card straight away.**

This design covers parts of the earlier sub-projects B (the card fixed on your own shelf, progress for Unwritten), C (the card on the profile header, independent of the mural) and D (sharing the card, og:image). It leaves out the rest, listed under non-goals.

## Goals

### 1. The card heads every profile

Mockup: option **D, "album cover"**. The generators are in `2026-11-02-reader-card-prominence-mockups/`. Run `npx tsx cards.mts /tmp/c.json && node compare.mjs /tmp/c.json /tmp/x.html`; the last row of the output is D.

- At the top of a reader's profile, above the tabs, the card shows large and centred, front face up.
- Behind it, the top band is the card itself, heavily blurred and faded into the page background. Each profile picks up its reader's colours. Dark-print cards give a strong band. Paper-print cards give a soft, near-plain one. Both are accepted.
- Under the card come the existing header pieces: name, counts, Follow / owner controls. Then come the tabs and the mural, as today.
- Tapping the card turns it to show the back pages, reusing today's turner and viewer (`mobile/src/features/murals/ReaderCardTurner.tsx`, `ReaderCardViewer.tsx`; `frontend/src/components/readerCard/ReaderCardTurner.tsx`, `ReaderCardViewer.tsx`).
- It applies on both clients, on both kinds of profile:
  - **Mobile, someone else's profile:** `ProfileScreen`, reached via `mobile/src/app/(app)/(home,arena,library,search,you)/u/[username].tsx`.
  - **Mobile, your own shelf:** `mobile/src/features/community/MyShelfScreen.tsx`, the You tab → "Your shelf".
  - **Web, someone else's profile:** `frontend/src/pages/CommunityProfilePage.tsx`.
  - **Web, your own shelf:** `frontend/src/components/OwnShelfView.tsx`.
- **Visitors see visitor data only.** This is exactly what a visitor can see today: style, motto, signature book, highlight. They never see `leaders`, `missing` or annotation text (`visitorView`, `packages/shared/src/library/readerCardFacts.ts:83`).
- **Your own profile shows the same visitor view**, so you see what others see. The user agreed to this. Your own profile also carries **Share** and **Edit card** actions next to the card. Edit goes to the existing editor (`/reader-card` on mobile, `/dashboard/reader-card` on web).
- **States:**
  - **Settled:** the card as it is.
  - **Leaning:** the Leaning card the renderer already draws.
  - **Unwritten:** the existing blank card with "—". The owner alone also sees a progress line, e.g. "3 more books to your card", taken from the facts the editor already uses. Visitors see only the blank card.
- **A private profile shows no card**, as today (`ProfileScreen.tsx:96-105`).
- The card needs a delivery path that doesn't depend on the mural. Today `PublicReaderCard` reaches visitors only through the mural's public payload (`backend/src/modules/murals/domain/publicPayload.ts:39-46`, `needsReaderCard`). The profile view (`GET /community/profiles/:username`, `backend/src/modules/community/routes.ts:157`) or a sibling endpoint must carry it.

### 2. The mural block goes away

- `readerCard` stops being a mural block kind:
  - remove it from the add-block menus;
  - remove it from the "My shelf" preset;
  - remove it from the mural renderers;
  - remove the mural payload's `needsReaderCard` path, if nothing else uses it.
- Existing murals that contain the block lose it. Nothing replaces it in the grid; the space is simply freed.

### 3. Your own card, close at hand

- With goal 1, your card is the first thing on your shelf: You tab → Your shelf, 2 taps. The user said that is enough.
- The You-tab "Reader card" tile (`mobile/src/features/you/YouScreen.tsx:48-62`) stays as the way into the editor. So does the web nav area (`frontend/src/lib/areas.ts:32`).

### 4. Sharing the card

- **Share** on your own profile opens the existing share sheet:
  - **Mobile:** `ContentShareSheet` (`mobile/src/features/sharing/ContentShareSheet.tsx`). The user asked for the same features that exist today: create link, send link, QR, stop sharing, share as image (save / send). The image is the card front. Whether to add the back as well is the builder's call.
  - **Web:** the web equivalent that murals use today.
- **The public link works like a mural link.** The owner creates it and can switch it off. Until it is created, nobody outside sees anything. It is a token URL under `FRONTEND_URL`, following `/shared/murals/:token` (`backend/src/modules/murals/plugin.ts:33`).
- **The public page needs no account.** It shows only:
  - the card, with the same blurred-card backdrop, turnable to its back pages;
  - the reader's name;
  - an "Open in Scripta" action.
  - It shows no mural and no rest of the profile.
- **The data on the public page is the visitor view**, the same as goal 1.
- **The link works whatever the profile's visibility.** The user decided this. A private reader can share their card by link. The profile stays private and still shows no card.
- **In the app**, the link opens a card-only screen that mirrors the public page: backdrop, turnable card, name. It does not open the profile, because the profile may be private. When the profile is visible to the viewer, the screen also offers a way to the profile (Claude's call).
  - Android intent filters and iOS `applinks:atmyshelf.com` already route some `/shared/...` links into the app (`mobile/app.json:24-47`). The card's path needs adding there.
  - A change to `app.json` intent filters is native, so it needs a store build. Until phones have that build, the link opens the web page, which is accepted.
- **Link previews:** pasted into WhatsApp and the like, the link previews with the card image (og:image, plus og:title with the reader's name).

## Non-goals

- A compact card on Home. This was sub-project B, and the user didn't ask for it.
- Making the reader glyph tappable to open the card. This was sub-project C.
- A one-time full-screen "reveal" when a card settles or changes plate. This was sub-project B.
- Leaning shown as progress ("leaning to the Cartographer: missing X"). Leaning shows its card as-is.
- Any change to the card artwork, the editor's options, or the narrow-web navigation.
- og:image for profiles or for shared murals. This design only covers the card's share link.
- A per-profile "show my card" switch. The card heads every public profile.

## Anti-goals

- **A visitor must never see owner-only data.** This applies on the profile, on the public page, in the share image and in the og:image. Owner-only data means leaders, missing, annotations, and the progress line.
- **Removing the mural block must not break an existing mural.** No mural with a stale `readerCard` block may crash or render a hole on either client. This includes phones still on an older over-the-air bundle that receive a payload with or without the block.
- **Sharing must not change profile visibility.** Creating or stopping the card link must leave the profile exactly as it was. The card itself must not appear on a private profile.
- **A wrong colour band.** The backdrop must come from the same card the reader sees, not from a separate guess of the archetype colour.

## Constraints and known facts

- **One renderer.** `renderPlate` / the reader-card renderer in `packages/shared/src/readerCards/render.ts` draws the card on both clients, at any width. The blurred backdrop is that same image, scaled up and blurred. Each client blurs with whatever it has: CSS `filter: blur()` on web, an image blur on React Native.
- **No OG tags today.** The web app is a client-rendered Vite SPA on Cloudflare Pages. A crawler fetching `/shared/...` only gets `index.html`. So og:image needs:
  - a server-side response that carries the tags, for example backend-served HTML at the share URL, or a Pages Function;
  - a server-side PNG of the card.
  The earlier spec planned server rendering with sharp from the same renderer (`2026-10-07-reader-card-enrichment-design.md:400`). The builder chooses the mechanism and records why in the plan.
- **Images go to R2.** Covers already live in R2 (bucket `atmyshelf-images`). If a card PNG is cached, it belongs there or behind the existing CDN, not on the Railway volume, which has filled up before.
- **Share-link precedent.** Mural links (`POST /murals/:id/share`, `GET /murals/shared/:token`, `backend/src/modules/murals/routes.ts:181,286`) and library links (`/library/shared/:token`) are the patterns to follow for token creation, revocation and the unauthenticated route.
- **Security.** The branch touches share links and who can see what, so it runs the `security-review` skill before merge (`CLAUDE.md`).
- **Mobile releases.** Mobile goes out over the air when there is no native change. A new native module (e.g. for blur) would need a store build. Prefer what is already in the app.
- **Tests.** New pure logic needs tests: the visitor-safe card payload for the profile and the public page, and the progress line. The visibility rules need route tests: private profile, revoked token, unknown token.

## Claude's calls (not asked of the user)

- **Visitors see the Leaning card as-is**, with no "leaning" wording beyond what the card already prints.
- **The public page is the only one that gets OG tags** in this project.
- **The share image is the front face.** Adding the back is left open.
- **What happens to existing murals with the block:** strip it on read (in the shared normaliser) or with a one-off migration. The builder picks, but the layout must not be reflowed by a guess.
- **Neighbouring blocks keep their coordinates when the card block is removed.** If a normaliser would compact or reflow the grid, use the migration instead.
- **Old bundles that save a mural still containing a `readerCard` block** get a successful save, with the block dropped server-side. No 400, and no other block is touched.
- **You always see your own card on your own shelf**, along with Share and Edit card, whether your profile is published, unpublished or private. Visibility only governs what other people see. So reading your own card is an owner-authenticated read that ignores visibility.
- **A reader with no imported library, or no stored card, gets the blank Unwritten card.** This holds on the profile and on the public page, and is never an error. The profile delivery must not copy the mural resolver's "Reader card … is unavailable" throw (`backend/src/modules/library/publicResolver.ts:254`).
- **One card link per user.** Stopping it kills that token for good. Sharing again mints a new token.

## Left to the builder

- Endpoint shape for the profile card: a field on the profile view, or a sibling route.
- Blur strength, fade length, card size per breakpoint, the web layout at desktop width, and text colour over dark bands. Text over a dark-print band must stay readable; the mockup flips to paper-coloured text.
- Where Share and Edit sit around the card on your own profile.
- The public page's route name and look, beyond the elements listed in goal 4.
- The og:image mechanism, its size and its caching.
- Wording of the progress line and the "Open in Scripta" action, in both locales (en, pt-PT).
