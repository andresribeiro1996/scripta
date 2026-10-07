# Shared feature APIs behind a request port

Date: 2026-10-07
Status: draft, from the architecture review (candidate #3). Decisions below were agreed in the brainstorm.

## Problem

Web and mobile each carry their own module for every backend feature, and they call the same endpoints. Nine features are copied this way: arena, tierlists, quizzes, community, public share links, socials, gallery, murals and works. The response types are copied too, and they have drifted:

- **Web arena types are short.**
  - Web `TournamentSummary` (`frontend/src/api/arena.ts:11`) lacks `covers`, `filledSlots` and `winner`, which the backend sends.
  - Mobile has these fields.
- **Voting-board books are typed wrong.**
  - Web types them as `Array<Record<string, unknown>>`.
  - Mobile types them as `PublicBook` (`mobile/src/features/tierlists/api.ts:31`), with the wrong nullability.
  - The backend sends `PublicBookData`.
- **Backend fields are missing from client types.**
  - `VotedTierlist` omits the `covers` the backend sends.
  - `CommunityProfileView` omits `mural.profile`.
- **Path parameters are encoded inconsistently.**
  - Web doesn't encode share tokens.
  - Mobile does.
  - Neither encodes ids.
- **The tournament page ignores the viewer's session on both clients.**
  - `GET /arenas/:id` reads an optional session so a signed-in viewer's "you voted" badges reflect the account (`backend/src/modules/arena/routes.ts:107-112`).
  - Web calls it with `publicFetch`, and mobile calls it without `auth`.
- **Small differences with no reason behind them:**
  - **Publishing a quiz:** mobile sends `{}` and web sends nothing.
  - **The `voterToken` parameter:** web always appends `?voterToken=`, while mobile appends it only when given.
  - **Fetching a ballot:** web has one function with a nullable id, mobile has two.
  - **Unwrapping:** mobile returns the raw `{board}` from `fetchPlayBoard` and the raw `{people}` from people search, while web unwraps both.
  - **Auth flags:** mobile callers pass `signedIn`/`authenticated` flags, while web asks `getSession()` inside the API module.

The backend has its own copies as well: `GalleryImage`, `SocialStatus`/`SocialProvider`, `PublicBookData`/`PublicHighlight`, quizzes `PlayBoard`, and a `TierlistData` that is shared `ResolvedTierlist` under another name. Nothing links any of these copies, so a backend change that breaks a client compiles everywhere.

## Decisions

| Question | Answer |
|---|---|
| Scope | Shared response types and shared per-feature API factories. Each client keeps its own request client (`apiFetch`, `createApiClient`), refresh logic and `ApiError` |
| Shape | Factories over a port: `createArenaApi(request)` and so on, following the `createLibrarySaver`/`createCoverResolver` injection pattern |
| Auth in the port | Three-way per endpoint: `"required" \| "optional" \| "none"`, decided by the backend route's guard |
| Backend | Adopts the shared types in this work. Identical backend copies are deleted, and wire builders are annotated with the shared types |
| Behaviour | Unchanged except for the fixes listed under "Behaviour changes" |

## Design

### The port: `packages/shared/src/api/`

`port.ts`:

```ts
export type ApiAuth = "required" | "optional" | "none";

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth: ApiAuth;
  signal?: AbortSignal;
}

export type ApiRequest = <T>(path: string, init: ApiRequestInit) => Promise<T>;
```

- `auth` is required, so every endpoint states its mode.
- `body` is a plain value. The adapter serialises it, and a `FormData` passes through untouched.

`path.ts` exports `apiPath`, a template tag that applies `encodeURIComponent` to every interpolated value. Query strings are built inside the factory that needs one, the same way the clients build them today.

```ts
apiPath`/arenas/${id}/duels/${duelId}/vote`
```

The new folders (`api`, `public`, `socials`, `gallery`) export from the package root, the same way `arena` and `works` already do, so `package.json` needs no new subpath exports. Community stays subpath-only (`@scripta/shared/community`), as it is today.

### Factories: `packages/shared/src/<feature>/api.ts`

Each factory takes an `ApiRequest` and returns an object of endpoint functions:

- Each function builds the path, sets the method, auth mode and body, and unwraps the response envelope.
- Endpoints with no response body return `void`. That hides the client difference where an empty body comes back as `null` on web and `{}` on mobile.
- Shared functions catch nothing. Errors propagate as each client's `ApiError`.

| Factory | Endpoints |
|---|---|
| `createArenaApi` | every `/arenas` route either client calls today (12) |
| `createTierlistsApi` | CRUD, `GET /tierlists/:id` (web only today), open-voting, voting state, results, voted list, voting board, and ballots (submit, `fetchBallot(code, ballotId)`, `fetchMyBallot(code)`) |
| `createQuizzesApi` | CRUD, publish, play state, results, play board, submit play, fetch play, public results |
| `createCommunityApi` | the 15 `/community` routes |
| `createPublicApi` | `fetchSharedMural(token)`, `fetchSharedLibrary(token)` |
| `createSocialsApi` | status list, link-session (returns the `linkId`; the client navigates), Bluesky connect, disconnect, post |
| `createGalleryApi` | list, delete |
| `createMuralsApi` | the 13 mural and folder routes |
| `createWorksApi` | `fetchWork(id)` |

- **Union of endpoints.** A factory covers every endpoint either client uses.
- **Platform-specific pieces stay in the one client that needs them.** Those pieces are:
  - Uploads: gallery upload, avatar, tier-list share video, import preview.
  - Social-connect navigation (`window.location` / `Linking`).
  - `shareNatively`.
  - Waitlist and books-admin.
  - Mobile arena `resolveCover`, which is a covers call.
- **Names.** Where the two clients already use different names, shared takes mobile's plain names, such as `createMural` and `fetchFolders`. A client keeps its local name by renaming while destructuring, for example `createMural: createMuralApi`.
- **Arguments.** Where argument shapes differ:
  - `createTournament` takes the input object.
  - `fetchTournament(id, voterToken?)` appends the token only when given.
  - `fetchPlayBoard` and people search unwrap (`.board`, `.people`).
  - `publishQuiz` sends no body.
  - Optional-auth functions take no auth flag.

### Auth mode per endpoint

The mode comes mechanically from the backend route:

| Backend route | Mode |
|---|---|
| `authGuard` preHandler | `"required"` |
| reads `getOptionalAuthenticatedUser` (directly or via `voterFor`/`playerFor`) | `"optional"` |
| neither | `"none"` |

`getOptionalAuthenticatedUser` answers 401 for an expired token rather than treating the caller as anonymous. So when a token is sent on an optional route, the client has to keep its 401 recover-and-retry.

### Adapters

**Web, `frontend/src/api/request.ts`:**

```ts
export const request: ApiRequest = async (path, { method, body, auth, signal }) =>
  (await (auth === "none" ? publicFetch : apiFetch)(path, {
    method, signal,
    body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
  })) as never;
```

- `"required"` and `"optional"` both go to `apiFetch`, which sends the token whenever a session exists and refreshes on 401. That is today's web behaviour.
- `"none"` goes to `publicFetch`, which never sends a token.

**Mobile, `mobile/src/core/request.ts`:** a `createRequest(apiClient, getAccessToken)` maps the mode to `apiClient.request`'s `auth` flag. `core/api.ts` wires the singleton.

| Mode | `auth` | Result |
|---|---|---|
| `"required"` | `true` | Unchanged: fails fast with "Not signed in" when no tokens are held, and recovers and retries on a 401 |
| `"none"` | `false` | Never sends a token |
| `"optional"` | `getAccessToken() !== null` | Sends the token, with recover and retry, only if one is held right now, which is the same rule as web |

There is one accepted edge case on mobile. When a refresh has just failed with a 5xx, the access token is null while the user is still signed in, so an optional call goes out anonymously. Today a `signedIn: true` flag would refresh first. The next required call refreshes as usual.

### Shared types

| Feature | Types (new home) | Changes vs today |
|---|---|---|
| arena (`arena/types.ts`) | `Tournament` (was `TournamentSummary`), `TournamentView` | Web gains `covers`, `filledSlots`, `winner`. The rename avoids clashing with community's feed-card `TournamentSummary` |
| tierlists (`tierlists/types.ts`) | `Tierlist`, `VotingBoard`, `BallotResponse`, `VotedTierlist` | `VotingBoard.books` becomes `PublicBookData[]`; mobile `PublicBook` is deleted. `VotedTierlist` gains `covers` |
| quizzes (`quizzes/types.ts`) | `Quiz`, `PlayBoard`, `PlayResponse`, `PublicResultPlay` | none |
| public (`public/types.ts`) | `PublicBookData`, `PublicHighlight`, `SharedMuralPayload`, `SharedLibraryPayload` | none |
| community (`community/types.ts`) | `CommunityProfileView` | Gains `mural.profile`. `tierlists` becomes `Record<string, ResolvedTierlist>` |
| socials (`socials/types.ts`) | `SocialProvider`, `SocialStatus` | none |
| gallery (`gallery/types.ts`) | `GalleryImage` | none |
| murals | `Mural` (already shared) | `coverImageId`/`coverImageUrl` become `?: string \| null`, because the backend sends `null` |

### Backend adoption

Backend copies that are identical to the shared type are deleted, and the backend imports the shared type instead:

- gallery `GalleryImage`
- socials `SocialProvider` and `SocialStatus`
- `PublicBookData` and `PublicHighlight` in `library/publicResolver.ts`
- quizzes `PlayBoard`
- tierlists:
  - `TierlistData` (`service.ts:448`), replaced by `ResolvedTierlist`
  - `WorksBoard` and `WorksTier`, replaced by `TierlistData` and `TierDefinition`
  - `HistogramCell`
  - `Placement`
- arena `SeedBookView`, `DuelSideView` and `DuelView`, replaced by `SeedBook`, `DuelSide` and `Duel`

Domain types that differ from what goes on the wire (`data: unknown` on `Tierlist`/`Quiz`, `blocks: unknown[]` on `Mural`) stay internal. The function that builds each response declares the shared type as its return. Where the answer is built inline in a route, the route uses `satisfies` on the inner object. The builders that get annotated:

| Module | Builders |
|---|---|
| arena | `tournamentForWire`, `summariesForWire`, and the `POST /arenas` answer, which today skips `wire.ts` |
| tierlists | `answer()`, the inline objects in `routes.ts`, and `boardBooks`, which is `unknown[]` today |
| quizzes | `quizToWorks` and the inline play answer |
| community | the profile view |
| murals | `toMural`, the shared-mural answer, and `resolveMuralPublicPayload` |
| gallery | `toGalleryImage` |
| socials | `listStatuses` |

- **Narrowing `unknown`.** Where a wire builder turns `unknown` data into a shared shape, the existing canonicalising function already produces that shape (for example `canonicalBoard`). The annotation moves onto it. No runtime validation is added.
- **Envelopes aren't typed.** Response envelopes (`{ tournament }`, `{ tierlists }`) are not typed in shared. The existing route tests pin them.

## Behaviour changes

Everything not listed here stays exactly as it is today.

1. **Path parameters are encoded on both clients**, through the `apiPath` template tag.
2. **`GET /arenas/:id` sends the viewer's token** when one is held, on both clients. This fixes the "you voted" badges for signed-in viewers.
3. **Mobile optional routes follow the "token if held" rule.** These are:
   - profile and activity, which were always `auth: true` and failed fast
   - `fetchMyBallot`
   - vote, ballot, play and discover
   - `fetchWork`

   For profile and activity this has no visible effect, because they sit behind `(app)/_layout.tsx` and are only reached signed in.
4. **Types match the backend**, as in the shared types table.
5. **The small differences are unified** as described under "Factories". Callers that branch on the session today do the branching themselves:
   - mobile `VoteTierlistScreen.tsx:71,84` and `QuizPlayScreen.tsx:45`
   - web `useTierlistVoting.ts:38`

## Testing

- **Shared:**
  - `path.test.ts` checks `apiPath` encoding.
  - One `api.test.ts` per factory records calls on a fake `ApiRequest`. For every endpoint it asserts the path, method, auth mode and body, and that the envelope is unwrapped.
  - These are written from today's client code, with only the agreed changes, and become the contract.
- **Web:** `frontend/scripts/test-request.mts` stubs `fetch` and the session, and checks:
  - `"none"` sends no `Authorization` even when signed in
  - `"optional"` and `"required"` send the token when signed in
  - a JSON body is stringified with a JSON content type
  - `FormData` passes through
- **Mobile:** `core/request.test.ts` checks the three mappings against a fake `ApiClient` and token getter.
- **Backend:** `typecheck` is the drift guard. The existing route tests must pass unchanged.
- **Both clients:** `typecheck` and `test` must stay green. Web `lint` must stay green.

## Delivery

There are five stacked PRs. Each one is complete across shared, web, mobile and backend for its features:

1. Port, `path`, both adapters, and **arena**.
2. **tierlists**, CRUD and voting.
3. **quizzes**.
4. **public** and **community**.
5. **socials**, **gallery**, **murals** and **works**.

**Review gates:**
- **Security review.** `security-review` runs on PRs 1–4, because they change which requests carry a token.
- **Device check.** One `device-checker` smoke pass runs on mobile after PR 4:
  - a signed-in arena vote, then the tournament's "you voted" badges
  - an anonymous tier-list ballot
  - a signed-in quiz play
  - a community profile

  The device pass gates the merge, not the PR.

## Out of scope

- **Merging the request clients.** The two clients stay separate, and so do refresh and `ApiError`. Web still triggers a second refresh on a late 401 from an already-rotated token.
- `/auth/*` calls and appearance.
- Library, covers and book search, which already follow the injection pattern.
- Response envelope types.
- Runtime validation of responses.
- Backend routes no client calls: `/arenas/public`, `/tierlists/public` and `/gallery/:id/file`.
