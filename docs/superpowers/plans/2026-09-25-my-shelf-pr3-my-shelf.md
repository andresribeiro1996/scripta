# My shelf PR 3: the My shelf tab. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner always sees their shelf. Mobile's Profile tab becomes My shelf (Shelf / Library / Activity), private by default. Web's owner view renders the shelf whether or not it's published.

**Architecture:** The backend gains an owner-only view of the caller's profile state (`GET /community/profile`) and a way to choose the shelf mural without publishing (`PUT /community/profile/mural`). Owners can read their own activity while private. Clients render the owner's shelf from the owner's own data, the way the mural editor does, never from the redacted public payload.

**Tech Stack:** Fastify + zod + `node:test` (backend), `@scripta/shared` types, Expo Router + TanStack Query (mobile), React + React Router + Tailwind (web).

**Spec:** `docs/superpowers/specs/2026-09-25-my-shelf-release-1-design.md`, section "3. My shelf".

## Global Constraints

- No code comments unless the surrounding code's pattern demands one; the why goes in commit messages.
- Minimum code; reuse existing components (`MuralCanvas`, `LibraryGrid`, `BookCard`, `ActivityList`, `FeedSettingsDialog`, `Dialog`, `Menu`, `SwipeableTabs`). No new packages.
- Visitors never see a private shelf: `getProfileByUsername` and `getLibrary` behaviour is unchanged.
- Nothing publishes automatically. Publishing always goes through a confirmation.
- Tab title is exactly `My shelf`, and the status chip reads exactly `Private` or `Published`.
- Backend tests need the CI env preamble: run them as `npm test --workspace backend` from the repo root, whose script already sets it up. If it exits at import with an env error, copy the env block from `.github/workflows/*.yml` into your shell.
- In a worktree session, run git as `/usr/bin/git …` from the worktree root.

---

### Task 1: Backend owner profile, shelf mural, and owner activity

**Files:**
- Modify: `backend/src/modules/community/service.ts` (interface at `:68-87`, `publishedUserId` at `:96-102`, `getActivity` at `:313-314`, and new methods next to `publishProfile`)
- Modify: `backend/src/modules/community/routes.ts` (authed routes, next to `/community/profile/publish`)
- Modify: `packages/shared/src/community/types.ts` (add `OwnProfile`)
- Test: `backend/src/modules/community/service.test.ts`, `backend/src/modules/community/routes.test.ts`

**Interfaces:**
- Produces (shared): `interface OwnProfile { muralId: string | null; published: boolean; feedSettings: FeedSettings }`, exported from `@scripta/shared/community`.
- Produces (service): `getOwnProfile(userId: string): OwnProfile` and `setShelfMural(userId: string, muralId: string): void`.
- Produces (HTTP): `GET /community/profile` → 200 `OwnProfile`; `PUT /community/profile/mural` `{ muralId }` → 204, 400 on a bad body or a mural the caller doesn't own.

- [ ] **Step 1: Write the failing service tests**

Append to `service.test.ts`, using its existing `createRepoFake`/`createDeps` helpers:

```ts
test("own profile reports a private shelf without a profiles row", () => {
  const { repo } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.deepEqual(service.getOwnProfile("alice"), { muralId: null, published: false, feedSettings: DEFAULT_FEED_SETTINGS });
});

test("choosing the shelf mural keeps the profile private and checks ownership", () => {
  const { repo } = createRepoFake();
  const { deps, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  ownedMurals.add("alice:m1");
  assert.throws(() => service.setShelfMural("alice", "m2"), MuralNotOwnedError);
  service.setShelfMural("alice", "m1");
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 0);
  assert.equal(row.mural_id, "m1");
  assert.equal(row.published_at, null);
  assert.deepEqual(service.getOwnProfile("alice"), { muralId: "m1", published: false, feedSettings: DEFAULT_FEED_SETTINGS });
});

test("switching a published shelf announces the new mural once", () => {
  const { repo, events } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  ownedMurals.add("alice:m2");
  service.publishProfile("alice", "m1");
  const announcements = () => events.filter((event) => event.type === "mural_published").length;
  const before = announcements();
  service.setShelfMural("alice", "m2");
  service.setShelfMural("alice", "m2");
  assert.equal(announcements(), before + 1);
  assert.equal(repo.getProfileRow("alice")!.published, 1);
});

test("owners read their own activity before publishing; visitors still get 404", () => {
  const { repo } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.setShelfMural("alice", "m1");
  assert.doesNotThrow(() => service.getActivity("alice", "alice", undefined, 20));
  assert.throws(() => service.getActivity("alice", "bob", undefined, 20), ProfileNotFoundError);
  assert.throws(() => service.getActivity("alice", undefined, undefined, 20), ProfileNotFoundError);
});
```

Check how `createDeps` maps `usernames` to `findUserIdByUsername`, and adapt the `usernames.set` calls if the map is keyed the other way.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace backend`
Expected: FAIL. `getOwnProfile`/`setShelfMural` don't exist, and owner activity 404s.

- [ ] **Step 3: Implement the service**

Add `OwnProfile` to `packages/shared/src/community/types.ts`:

```ts
export interface OwnProfile {
  muralId: string | null;
  published: boolean;
  feedSettings: FeedSettings;
}
```

In `service.ts`, add `getOwnProfile` and `setShelfMural` to the `CommunityService` interface. Replace `publishedUserId` with a viewer-aware lookup, and keep the old name for its existing callers:

```ts
  const visibleUserId = (username: string, viewerId: string | undefined): string => {
    const userId = deps.findUserIdByUsername(username);
    if (!userId) throw new ProfileNotFoundError();
    if (userId === viewerId) return userId;
    const row = repo.getProfileRow(userId);
    if (!row || row.published !== 1) throw new ProfileNotFoundError();
    return userId;
  };
  const publishedUserId = (username: string): string => visibleUserId(username, undefined);
```

In `getActivity`, change `const userId = publishedUserId(username);` to `const userId = visibleUserId(username, viewerId);`.

Add the methods next to `publishProfile`:

```ts
    getOwnProfile(userId) {
      const row = repo.getProfileRow(userId);
      return { muralId: row?.mural_id ?? null, published: row?.published === 1, feedSettings: settingsFor(userId) };
    },
    setShelfMural(userId, muralId) {
      if (!deps.murals.ownsMural(userId, muralId)) throw new MuralNotOwnedError();
      const existing = repo.getProfileRow(userId);
      repo.upsertProfile({
        user_id: userId,
        published: existing?.published ?? 0,
        mural_id: muralId,
        published_at: existing?.published_at ?? null,
        updated_at: new Date().toISOString(),
        feed_settings: existing?.feed_settings ?? null
      });
      if (existing?.published === 1 && existing.mural_id !== muralId) emit(userId, "mural_published", "mural", muralId);
    },
```

Import the `OwnProfile` type where the interface needs it.

- [ ] **Step 4: Write the failing route test**

Append to `routes.test.ts`, following the existing `feed-settings PUT` test's pattern (`fakeService`, `authenticateAccessToken` decoration, `inject`):

```ts
test("own profile GET and shelf mural PUT are authed and validate the body", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        getOwnProfile: (userId) => ({ muralId: userId === "viewer" ? "m1" : null, published: false, feedSettings: { publications: true, reading: false, votes: true, follows: true } }),
        setShelfMural: (userId, muralId) => {
          calls.push({ userId, muralId });
        }
      })
    )
  );
  const auth = { authorization: "Bearer x" };
  const own = await app.inject({ method: "GET", url: "/community/profile", headers: auth });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().muralId, "m1");
  const bad = await app.inject({ method: "PUT", url: "/community/profile/mural", headers: auth, payload: {} });
  assert.equal(bad.statusCode, 400);
  const good = await app.inject({ method: "PUT", url: "/community/profile/mural", headers: auth, payload: { muralId: "m2" } });
  assert.equal(good.statusCode, 204);
  assert.deepEqual(calls, [{ userId: "viewer", muralId: "m2" }]);
  await app.close();
});
```

If `fakeService` needs defaults for the two new methods to compile, add throwing defaults there, matching how it stubs the others.

- [ ] **Step 5: Implement the routes**

In `buildCommunityRoutes`, next to the publish routes:

```ts
    app.get("/community/profile", { preHandler: authGuard }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.send(service.getOwnProfile(request.user.id));
    });

    app.put("/community/profile/mural", { preHandler: authGuard }, async (request, reply) => {
      const parsed = publishSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {muralId}." });
      try {
        service.setShelfMural(request.user.id, parsed.data.muralId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });
```

- [ ] **Step 6: Run the tests**

```bash
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend
npm test --workspace backend
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add backend/src/modules/community packages/shared/src/community/types.ts
/usr/bin/git commit -m "Let owners see and choose their shelf without publishing"
```

---

### Task 2: Client APIs and authenticated activity

**Files:**
- Modify: `mobile/src/features/community/api.ts`
- Modify: `frontend/src/api/community.ts`

**Interfaces:**
- Produces (both clients): `fetchOwnProfile(): Promise<OwnProfile>` and `setShelfMural(muralId: string): Promise<void>`. `fetchActivity` sends the signed-in token.

- [ ] **Step 1: Mobile**

In `mobile/src/features/community/api.ts`, import `OwnProfile` in the existing `@scripta/shared/community` type import and add:

```ts
export function fetchOwnProfile() {
  return apiClient.request<OwnProfile>("/community/profile", { auth: true });
}

export function setShelfMural(muralId: string) {
  return apiClient.request("/community/profile/mural", { method: "PUT", body: { muralId }, auth: true });
}
```

Add `auth: true` to `fetchActivity`'s request options, so an owner's own activity loads while private.

- [ ] **Step 2: Web**

In `frontend/src/api/community.ts`, import `OwnProfile` and add:

```ts
export async function fetchOwnProfile(): Promise<OwnProfile> {
  return (await apiFetch("/community/profile")) as OwnProfile;
}

export async function setShelfMural(muralId: string): Promise<void> {
  await apiFetch("/community/profile/mural", { method: "PUT", body: JSON.stringify({ muralId }) });
}
```

Change `fetchActivity` from `publicFetch` to `apiFetch`, since the profile page already requires a session.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck --workspace mobile
npm run typecheck --workspace frontend
/usr/bin/git add mobile/src/features/community/api.ts frontend/src/api/community.ts
/usr/bin/git commit -m "Clients: own-profile and shelf-mural calls; send the token for activity"
```

---

### Task 3: Mobile My shelf screen

**Files:**
- Create: `mobile/src/features/community/MyShelfScreen.tsx`
- Create: `mobile/src/features/community/OwnLibraryPane.tsx`
- Modify: `mobile/src/app/(app)/(library)/me.tsx`
- Modify: `mobile/src/app/(app)/_layout.tsx` (the `(library)` tab)
- Modify: `mobile/src/features/community/ProfileScreen.tsx` (export `MuralPicker` with configurable copy)

**Interfaces:**
- Consumes: `fetchOwnProfile`, `setShelfMural`, `publishProfile`, `unpublishProfile` (Task 2); `fetchMural` and `useMurals` (murals feature); `useLibrary`; `fetchGalleryImages`; `fetchTierlists`; `MuralCanvas`; `ActivityList`; `FeedSettingsDialog`.
- Produces: `MyShelfScreen()`, `OwnLibraryPane()`, and `MuralPicker({ visible, busy, title, description, actionLabel, onClose, onPick })`, exported from `ProfileScreen.tsx`.

- [ ] **Step 1: Generalise `MuralPicker`**

In `ProfileScreen.tsx`, export `MuralPicker` and add props `title`, `description` and `actionLabel`, used where it currently hard-codes "Publish profile", "Pick the mural that becomes your public page." and "Publish". Update its two call sites in `ProfileScreen` to pass those exact strings, so visible behaviour doesn't change.

- [ ] **Step 2: Build `OwnLibraryPane`**

A pane showing the owner's own books:
- `useLibrary()` for books and style (`resolveLibraryStyle(library?.data.style)`).
- An `Input` (search, placeholder "Search your books") and a row of status chips from `STATUS_FILTER_OPTIONS`, each labelled with its count, e.g. `Reading 7`. Show "All" for the `all` option. Chips are `Pressable`s styled like the app's existing filter pills, filled with `accentSoft` when selected. Filtering uses `filterBooks(books, query, status)`.
- The grid is `LibraryGrid` with `renderItem` rendering `BookCard` exactly as `LibraryScreen.tsx:289-304` does, but without selection props. Compute `cardStyle` the same way, including the series lookup `LibraryScreen` uses.
- An add button rendered as an `IconButton` `name="add"` in the list header, pushing `/add-book`.
- `ListEmptyComponent`: `EmptyState` "No books match" when filtering; "Start your library", with an action to `/import`, when the library is empty.

- [ ] **Step 3: Build `MyShelfScreen`**

- Data: `own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile })`; `mural = useQuery({ queryKey: ["murals", own.data?.muralId], queryFn: () => fetchMural(own.data!.muralId!), enabled: Boolean(own.data?.muralId) })`; library, gallery and tierlists exactly as `MuralEditorScreen.tsx:37-39` loads them; `profile` built the same way as `MuralEditorScreen.tsx:113`.
- Header via `<Stack.Screen options={{ headerShown: true, title: "My shelf", headerRight }} />`. `headerRight` renders:
  - a status chip (`Pressable`, pill shape, `border` token, caption text) reading `Published` or `Private`. Pressing it opens the publish-confirm `Dialog` when private, or the existing "Unpublish your profile?" `Dialog` when published;
  - a `Menu` with an `IconButton name="more"`. Items: `Edit shelf` (→ `/murals/<muralId>`, shown only with a muralId), `Manage library…` (→ `/library`), `Switch shelf mural…` (opens `MuralPicker` with title "Choose your shelf", description "Pick the mural that becomes your shelf.", actionLabel "Use this mural", `onPick` → `setShelfMural`), and `Feed settings…` (→ `FeedSettingsDialog` with `own.data.feedSettings`).
- The publish-confirm `Dialog` is titled "Publish your shelf?", with body "It becomes a public page at /u/<username>, and people can follow you." and a `Button` "Publish" → `publishProfile(muralId)`. Without a muralId, the chip action opens the `MuralPicker` in publish mode instead, using the old strings.
- After any mutation, invalidate `["community", "own-profile"]` and `["community", "profile", username]`.
- Body: `SwipeableTabs` with options Shelf / Library / Activity. Keep the last tab in a module-level `let lastTab` so returning to the tab restores it for the app session.
  - **Shelf**: with a muralId and a mural with blocks, a `ScrollView` containing `MuralCanvas` with `mural={{ ...mural.data, blocks: ensureBookBlockHeights(mural.data.blocks) }}` and own books, groups, images, tierlists and profile (read-only; don't pass `editable`). Otherwise an `EmptyState` titled "Your shelf is empty", body "Build a private page from your books. Only you can see it until you publish.", actionLabel "Create your shelf". The action creates a mural named "My shelf" via `useMurals().create`, calls `setShelfMural`, invalidates own-profile, then pushes `/murals/<id>`. If a muralId already exists but it has no blocks, it pushes `/murals/<muralId>` instead.
  - **Library**: `<OwnLibraryPane />`.
  - **Activity**: `<ActivityList username={user.username} />`.
- Errors: failed mutations show the existing `Toast` pattern ("Something went wrong. Try again."). A failed own-profile query shows `ErrorState` with Retry.

- [ ] **Step 4: Point the tab at it**

- `me.tsx`: render `<MyShelfScreen />`.
- `(app)/_layout.tsx`: the `(library)` tab gets `title: "My shelf"` and the `library` icon: `<Icon name="library" filled={focused} … />`.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck --workspace mobile
npm test --workspace mobile
/usr/bin/git add mobile/src
/usr/bin/git commit -m "Mobile: Profile becomes My shelf, private by default"
```

The body should say why: a reader who never published had no profile page at all, and the full library was hidden behind an overflow menu.

---

### Task 4: Mobile murals badge

**Files:**
- Modify: `mobile/src/features/murals/MuralsScreen.tsx:33-38` and the row at `:164`

- [ ] **Step 1: Source the badge from the own profile**

Replace the `ownProfile` query (currently `fetchProfile(username)`) with `useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile })`, and change the badge condition to `ownProfile.data?.muralId === item.id`. The badge text becomes `My shelf`.

- [ ] **Step 2: Fix the overlap**

Give the title `Text` in the name row `style={[typography.title, styles.name, { color: colors.text, fontWeight: "700" }]}` with `name: { flexShrink: 1 }`, so a long name truncates and the badge stays clear of the ⋯ button.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck --workspace mobile
/usr/bin/git add mobile/src/features/murals/MuralsScreen.tsx
/usr/bin/git commit -m "Murals: badge the shelf mural even while private"
```

---

### Task 5: Web owner shelf view

**Files:**
- Create: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx` (the `isNotFound` owner branch and the `isSelf` render)
- Modify: `frontend/src/layouts/DashboardLayout.tsx:114,212` (`aria-label="Your profile"` → `"My shelf"`, and add a matching `title`)
- Modify: `frontend/src/pages/MuralsListPage.tsx:48,441-442`

**Interfaces:**
- Consumes: `fetchOwnProfile`, `setShelfMural`, `publishProfile`, `unpublishProfile` (Task 2); `useLibrary`, `useMurals`, the gallery hook, and `MuralCanvas` with the props `MuralEditorPage.tsx:560-566` passes, but `editMode={false}` and no edit callbacks.
- Produces: `OwnShelfView({ username })`.

- [ ] **Step 1: Build `OwnShelfView`**

- Data: a `useQuery` on `["community", "own-profile"]` → `fetchOwnProfile`; the shelf mural from `useMurals()` data by id; library books and groups; gallery images.
- Header: the username, a Private/Published chip (the pill style the page already uses), and buttons. When private: "Publish…", which confirms with the same copy as mobile, then `publishProfile(muralId)`. When published: the existing `OwnerControls`, meaning switch, unpublish and feed settings. "Switch shelf mural" uses `setShelfMural` while private.
- Body: the Mural and Activity tabs the page already uses. Mural renders `MuralCanvas` with own data. With no shelf mural, or one with no blocks: an `EmptyState` "Your shelf is empty" with a "Create your shelf" button that creates a "My shelf" mural, calls `setShelfMural`, and navigates to `/dashboard/murals/<id>`. Activity uses the existing `useCommunityActivity(username)`.

- [ ] **Step 2: Use it for the owner**

In `CommunityProfilePage`, when `isOwnHandle`, return `<OwnShelfView username={username} />` before the visitor logic: both the `isNotFound` branch and the loaded-view branch. Delete `UnpublishedOwnProfile` once nothing uses it. Visitors keep the existing view.

- [ ] **Step 3: Badge and label**

- `MuralsListPage`: replace `useCommunityProfile(session…)` with the own-profile query, use the condition `ownProfile.data?.muralId === mural.id`, and change the text to `My shelf`.
- `DashboardLayout`: set both avatar links to `aria-label="My shelf"` with `title="My shelf"`.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck --workspace frontend
npm run lint --workspace frontend
npm test --workspace frontend
/usr/bin/git add frontend
/usr/bin/git commit -m "Web: owners see their shelf whether or not it's published"
```

---

### Task 6: Full verification and device check

- [ ] **Step 1: Everything green**

```bash
npm run build --workspace @scripta/shared
npm test --workspace @scripta/shared
npm run typecheck --workspace backend
npm test --workspace backend
npm run typecheck --workspace frontend
npm run lint --workspace frontend
npm test --workspace frontend
npm run typecheck --workspace mobile
npm test --workspace mobile
cd mobile && npx expo-doctor
```
Expected: all pass.

- [ ] **Step 2: Device check (mobile)**

Run `node scripts/dev-status.mjs --json`. If an emulator is free, run `node scripts/dev-emulator.mjs` from the worktree. The dev account's profile is published with an empty mural. Check:
- The tab reads **My shelf**, the header chip says **Published**, and Shelf shows the "Your shelf is empty" state.
- Library shows the 24 fixture books with working chips (Reading 7, Finished 11, To read 6) and search, and a book opens its sheet.
- Activity loads.
- Unpublish via the chip: the chip becomes **Private**, and Shelf and Activity still load. That's the case that used to 404.
- On Murals, the "My shelf" badge shows on the shelf mural and doesn't touch the ⋯ button.

Take screenshots into the scratch folder, run `npm run dev:release`, and report. If no emulator is free, say so and skip; don't wait.
