# Shared Feature APIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move nine features' response types and endpoint functions into `@scripta/shared`, behind one request port that web and mobile each adapt to their own request client. The backend checks its answers against the same types.

**Architecture:**
- `packages/shared/src/api/` holds three things:
  - `ApiRequest`, the port.
  - `ApiAuth`, a three-way auth mode.
  - `apiPath`, which encodes path segments.
- Each feature gets a `create<Feature>Api(request)` factory next to its shared types.
- Web (`frontend/src/api/request.ts`) and mobile (`mobile/src/core/request.ts`) each adapt their existing request client to the port. Each feature module then becomes one destructuring line over its factory.
- The backend deletes the copies of these types it declared itself and annotates its wire builders with the shared types.

**Tech Stack:**
- TypeScript, compiled with `tsc`.
- `@scripta/shared` is ESM, consumed through `dist`.
- Tests use `node:test`: through `tsx` in shared and mobile, and through `frontend/scripts/test-*.mts` on web.
- The backend is Fastify.

**Spec:** `docs/superpowers/specs/2026-10-07-shared-feature-apis-design.md`

## Global Constraints

- **No comments in new or rewritten code** (`AGENTS.md`). When you rewrite a client API module, delete its header comment blocks. They describe the old `apiFetch` wrappers and become false.
- **Rebuild shared before downstream checks.** After any change under `packages/shared`, run `npm run build --workspace @scripta/shared` before typechecking or testing frontend, mobile or backend. They consume `dist`.
- **Mobile tests need an env var.** Mobile tests and typecheck need `EXPO_PUBLIC_API_URL=http://localhost:3000` in the environment.
- **New backend tests go in the list.** Backend `npm test` runs an explicit file list. This plan adds no backend test files. If you add one, put it in `backend/package.json`'s `test` script.
- **Auth mode comes from the backend route.** `authGuard` means `"required"`. Reading `getOptionalAuthenticatedUser` (directly, or via `voterFor`/`playerFor`) means `"optional"`. Neither means `"none"`.
- **Every path value goes through `apiPath`.** No raw `${id}` interpolation in a factory path.
- **No-body endpoints return `void`.** Their shared function returns `Promise<void>` and never returns the request's result.
- **No catching in shared.** Shared functions do not catch. Errors propagate as each client's own `ApiError`.
- **Request clients stay as they are.** Do not touch `frontend/src/api/client.ts`, `mobile/src/core/apiClient.ts`, refresh logic, `/auth/*` calls, or the library, covers and book-search modules.
- **Platform-specific functions stay in their client:**
  - web and mobile `uploadGalleryImage`
  - mobile `renderTierlistShareVideo`
  - `startSocialConnect`'s navigation
  - `shareNatively`
  - mobile arena `resolveCover`
- **Shared uses mobile's plain names.** Web keeps its local names by renaming while destructuring, so its call sites don't change.
- **Each feature module keeps re-exporting the types its callers import from it.** Do this with `export type { … } from "@scripta/shared"`, so call-site imports keep working. The exception is renamed or deleted types, which are listed per task.
- **Import from where a type is declared.** Import paths inside `packages/shared` in this plan were written from the layout at `86bf295c`. If a type lives in a sibling file instead, import it from where it's declared. Don't move it.
- **Full verification before every commit.** Run the commands listed in the task's last step. A task is not done until all of them pass.

## Review Focus

1. **Expired token on an optional route (mobile).** `getOptionalAuthenticatedUser` answers 401 for an expired token. When a token is held, mobile `"optional"` must map to `auth: true` so the client's recover-and-retry runs. This is pinned in Task 3's test "optional with a held token maps to auth true".
2. **Signed-out web user on an optional route.** No `Authorization` header goes out. This is pinned in Task 2's test "optional without a session sends no token".
3. **Path values with reserved characters**, such as a share token or username containing `/`, `?`, `#` or a space, or a non-ASCII username. These must reach the backend as one encoded segment. This is pinned in Task 1's `apiPath` tests and in each factory's encoding test.
4. **No-body endpoints when mobile answers `{}`.** The shared function still resolves `undefined`, so no caller ever sees `{}`. This is pinned in Task 4's "void endpoints resolve undefined" test. Every later factory test repeats it.
5. **`FormData` through the web adapter.** It must not be stringified and must not get a JSON content type. This is pinned in Task 2's test "FormData passes through untouched".

---

## Phase 1 — port, adapters, arena (PR 1, branch `claude/shared-feature-apis`)

### Task 1: Shared port and `apiPath`

**Files:**
- Create: `packages/shared/src/api/port.ts`
- Create: `packages/shared/src/api/path.ts`
- Create: `packages/shared/src/api/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/api/path.test.ts`

**Interfaces:**
- Produces:
  - `type ApiAuth = "required" | "optional" | "none"`
  - `interface ApiRequestInit { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; auth: ApiAuth; signal?: AbortSignal }`
  - `type ApiRequest = <T>(path: string, init: ApiRequestInit) => Promise<T>`
  - `` apiPath(strings: TemplateStringsArray, ...values: Array<string | number>): string ``
  - All of these are exported from `@scripta/shared`.

- [ ] **Step 1: Link dependencies and build shared (worktree setup)**

Run from the worktree root:
```bash
npm run dev:link-deps
npm run build --workspace @scripta/shared
```
Expected: both exit 0.

- [ ] **Step 2: Write the failing test**

`packages/shared/src/api/path.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { apiPath } from "./path.js";

test("plain values pass through", () => {
  assert.equal(apiPath`/arenas/${"abc"}/duels/${"d1"}/vote`, "/arenas/abc/duels/d1/vote");
});

test("reserved characters stay inside one segment", () => {
  assert.equal(apiPath`/murals/shared/${"a/b?c#d e"}`, "/murals/shared/a%2Fb%3Fc%23d%20e");
});

test("non-ASCII usernames are percent-encoded", () => {
  assert.equal(apiPath`/community/profiles/${"zoë"}`, "/community/profiles/zo%C3%AB");
});

test("numbers are stringified", () => {
  assert.equal(apiPath`/x/${3}`, "/x/3");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, cannot find module `./path.js`.

- [ ] **Step 4: Implement**

`packages/shared/src/api/port.ts`:
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

`packages/shared/src/api/path.ts`:
```ts
export function apiPath(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce((out, part, index) => out + part + (index < values.length ? encodeURIComponent(String(values[index])) : ""), "");
}
```

`packages/shared/src/api/index.ts`:
```ts
export * from "./port.js";
export * from "./path.js";
```

In `packages/shared/src/index.ts`, add after the `auth.js` line:
```ts
export * from "./api/index.js";
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npm test --workspace @scripta/shared
npm run typecheck --workspace @scripta/shared
npm run build --workspace @scripta/shared
```
Expected: PASS and exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api packages/shared/src/index.ts
git commit -m "Add the shared request port and apiPath"
```

### Task 2: Web adapter

**Files:**
- Create: `frontend/src/api/request.ts`
- Test: `frontend/scripts/test-request.mts`

**Interfaces:**
- Consumes: `ApiRequest` and `ApiRequestInit` from `@scripta/shared` (Task 1), plus `apiFetch` and `publicFetch` from `frontend/src/api/client.ts`.
- Produces: `export const request: ApiRequest`, in `frontend/src/api/request.ts`.

- [ ] **Step 1: Write the failing test**

`frontend/scripts/test-request.mts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";

const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true });
const { setSession } = await import("../src/auth/tokenStore.ts");
const { request } = await import("../src/api/request.ts");

type Seen = { url: string; method: string | undefined; authorization: string | null; contentType: string | null; body: unknown };

async function capture(run: () => Promise<unknown>, answer: () => Response = () => Response.json({ ok: true })) {
  const original = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    seen.push({ url: String(url), method: init?.method, authorization: headers.get("Authorization"), contentType: headers.get("Content-Type"), body: init?.body });
    return answer();
  };
  try {
    const result = await run();
    return { seen, result };
  } finally {
    globalThis.fetch = original;
  }
}

function signIn() {
  setSession({ user: { id: "u1", email: "a@b.c", username: "a", avatarId: null }, accessToken: "access-1", refreshToken: "refresh-1" });
}

test("none sends no token even when signed in", async () => {
  signIn();
  const { seen } = await capture(() => request("/x", { auth: "none" }));
  assert.equal(seen[0]!.authorization, null);
  setSession(null);
});

test("optional and required send the token when signed in", async () => {
  signIn();
  const { seen } = await capture(async () => {
    await request("/a", { auth: "optional" });
    await request("/b", { auth: "required" });
  });
  assert.deepEqual(seen.map((s) => s.authorization), ["Bearer access-1", "Bearer access-1"]);
  setSession(null);
});

test("optional without a session sends no token", async () => {
  setSession(null);
  const { seen } = await capture(() => request("/a", { auth: "optional" }));
  assert.equal(seen[0]!.authorization, null);
});

test("a plain body is stringified with a JSON content type", async () => {
  const { seen } = await capture(() => request("/a", { method: "POST", body: { name: "N" }, auth: "none" }));
  assert.equal(seen[0]!.method, "POST");
  assert.equal(seen[0]!.body, JSON.stringify({ name: "N" }));
  assert.equal(seen[0]!.contentType, "application/json");
});

test("FormData passes through untouched", async () => {
  const form = new FormData();
  form.append("image", new Blob(["x"]), "x.png");
  const { seen } = await capture(() => request("/a", { method: "POST", body: form, auth: "none" }));
  assert.equal(seen[0]!.body, form);
  assert.equal(seen[0]!.contentType, null);
});

test("no body sends no body", async () => {
  const { seen } = await capture(() => request("/a", { method: "POST", auth: "none" }));
  assert.equal(seen[0]!.body, undefined);
});

test("the parsed body is returned", async () => {
  const { result } = await capture(() => request<{ ok: boolean }>("/a", { auth: "none" }));
  assert.deepEqual(result, { ok: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace frontend`
Expected: `test-request.mts` FAILS, cannot find `../src/api/request.ts`. The other suites pass.

- [ ] **Step 3: Implement**

`frontend/src/api/request.ts`:
```ts
import type { ApiRequest, ApiRequestInit } from "@scripta/shared";
import { apiFetch, publicFetch } from "./client";

async function send<T>(path: string, { method, body, auth, signal }: ApiRequestInit): Promise<T> {
  const payload = body === undefined || body instanceof FormData ? body : JSON.stringify(body);
  return (await (auth === "none" ? publicFetch : apiFetch)(path, { method, signal, body: payload })) as T;
}

export const request: ApiRequest = send;
```

- [ ] **Step 4: Run the checks**

```bash
npm test --workspace frontend
npm run typecheck --workspace frontend
npm run lint --workspace frontend
```
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/request.ts frontend/scripts/test-request.mts
git commit -m "Adapt the web request client to the shared port"
```

### Task 3: Mobile adapter

**Files:**
- Create: `mobile/src/core/request.ts`
- Modify: `mobile/src/core/api.ts`
- Test: `mobile/src/core/request.test.ts`

**Interfaces:**
- Consumes:
  - `ApiRequest` and `ApiRequestInit` from `@scripta/shared`.
  - `ApiClient` from `mobile/src/core/apiClient.ts`.
  - `getAccessToken` from `mobile/src/core/tokenStore.ts`.
- Produces:
  - `export function createRequest(apiClient: ApiClient, getAccessToken: () => string | null): ApiRequest`, in `mobile/src/core/request.ts`.
  - `export const request: ApiRequest`, in `mobile/src/core/api.ts`.

- [ ] **Step 1: Write the failing test**

`mobile/src/core/request.test.ts`:
```ts
/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient } from "./apiClient.js";
import { createRequest } from "./request.js";

function fakeClient() {
  const calls: Array<{ path: string; init: unknown }> = [];
  const apiClient: ApiClient = {
    async request(path, init) {
      calls.push({ path, init });
      return { ok: true } as never;
    },
  };
  return { calls, apiClient };
}

test("required maps to auth true", async () => {
  const { calls, apiClient } = fakeClient();
  await createRequest(apiClient, () => null)("/a", { auth: "required" });
  assert.deepEqual(calls[0], { path: "/a", init: { auth: true } });
});

test("none maps to auth false even with a held token", async () => {
  const { calls, apiClient } = fakeClient();
  await createRequest(apiClient, () => "token")("/a", { auth: "none" });
  assert.deepEqual(calls[0], { path: "/a", init: { auth: false } });
});

test("optional with a held token maps to auth true", async () => {
  const { calls, apiClient } = fakeClient();
  await createRequest(apiClient, () => "token")("/a", { auth: "optional" });
  assert.deepEqual(calls[0], { path: "/a", init: { auth: true } });
});

test("optional without a token maps to auth false", async () => {
  const { calls, apiClient } = fakeClient();
  await createRequest(apiClient, () => null)("/a", { auth: "optional" });
  assert.deepEqual(calls[0], { path: "/a", init: { auth: false } });
});

test("method, body and signal pass through, and the answer is returned", async () => {
  const { calls, apiClient } = fakeClient();
  const signal = new AbortController().signal;
  const result = await createRequest(apiClient, () => null)("/a", { method: "PUT", body: { x: 1 }, auth: "required", signal });
  assert.deepEqual(calls[0], { path: "/a", init: { method: "PUT", body: { x: 1 }, signal, auth: true } });
  assert.deepEqual(result, { ok: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile`
Expected: `request.test.ts` FAILS, cannot find `./request.js`.

- [ ] **Step 3: Implement**

`mobile/src/core/request.ts`:
```ts
import type { ApiRequest, ApiRequestInit } from "@scripta/shared";
import type { ApiClient } from "./apiClient";

export function createRequest(apiClient: ApiClient, getAccessToken: () => string | null): ApiRequest {
  return function request<T>(path: string, { auth, ...init }: ApiRequestInit): Promise<T> {
    return apiClient.request<T>(path, { ...init, auth: auth === "required" || (auth === "optional" && getAccessToken() !== null) });
  };
}
```

In `mobile/src/core/api.ts`, add the import and the export:
```ts
import { createRequest } from "./request";
```
```ts
export const request = createRequest(session.apiClient, getAccessToken);
```

- [ ] **Step 4: Run the checks**

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile
```
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/request.ts mobile/src/core/request.test.ts mobile/src/core/api.ts
git commit -m "Adapt the mobile request client to the shared port"
```

### Task 4: Shared arena types and `createArenaApi`

**Files:**
- Modify: `packages/shared/src/arena/types.ts`
- Create: `packages/shared/src/arena/api.ts`
- Modify: `packages/shared/src/arena/index.ts`
- Test: `packages/shared/src/arena/api.test.ts`

**Interfaces:**
- Consumes: `ApiRequest`, `ApiRequestInit` and `apiPath` (Task 1).
- Produces:
  - `Tournament`, `TournamentView`.
  - `createArenaApi(request: ApiRequest)`, returning these functions:
    - `createTournament(input: { name: string; bracketSize: number; roundDurationMinutes: number }): Promise<Tournament>`
    - `fetchMyTournaments(): Promise<Tournament[]>`
    - `fetchVotedTournaments(): Promise<Tournament[]>`
    - `fetchTournament(id: string, voterToken?: string): Promise<TournamentView>`
    - `setTournamentSlots(id: string, slots: Array<{ slotIndex: number; book: SeedBook }>): Promise<void>`
    - `randomFillTournament(id: string, pool: SeedBook[]): Promise<void>`
    - `startTournament(id: string): Promise<void>`
    - `voteOnDuel(tournamentId: string, duelId: string, voterToken: string, workId: string): Promise<void>`
    - `settleDuelEarly(tournamentId: string, duelId: string): Promise<void>`
    - `resolveTiebreak(tournamentId: string, duelId: string, winnerWorkId: string): Promise<void>`
    - `renameTournament(id: string, name: string): Promise<void>`
    - `deleteTournament(id: string): Promise<void>`
  - `type ArenaApi = ReturnType<typeof createArenaApi>`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/arena/api.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createArenaApi, type ArenaApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createArenaApi(request) };
}

const book = { workId: "w1", title: "T", author: "A", cover: null };

const cases: Array<[string, (api: ArenaApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["createTournament", (api) => api.createTournament({ name: "N", bracketSize: 8, roundDurationMinutes: 60 }), "/arenas", { method: "POST", body: { name: "N", bracketSize: 8, roundDurationMinutes: 60 }, auth: "required" }],
  ["fetchMyTournaments", (api) => api.fetchMyTournaments(), "/arenas/mine", { auth: "required" }],
  ["fetchVotedTournaments", (api) => api.fetchVotedTournaments(), "/arenas/voted", { auth: "required" }],
  ["fetchTournament with a voter token", (api) => api.fetchTournament("t1", "tok en"), "/arenas/t1?voterToken=tok%20en", { auth: "optional" }],
  ["fetchTournament without a voter token", (api) => api.fetchTournament("t1"), "/arenas/t1", { auth: "optional" }],
  ["setTournamentSlots", (api) => api.setTournamentSlots("t1", [{ slotIndex: 0, book }]), "/arenas/t1/slots", { method: "PUT", body: { slots: [{ slotIndex: 0, book }] }, auth: "required" }],
  ["randomFillTournament", (api) => api.randomFillTournament("t1", [book]), "/arenas/t1/random-fill", { method: "POST", body: { pool: [book] }, auth: "required" }],
  ["startTournament", (api) => api.startTournament("t1"), "/arenas/t1/start", { method: "POST", auth: "required" }],
  ["voteOnDuel", (api) => api.voteOnDuel("t1", "d1", "tok", "w1"), "/arenas/t1/duels/d1/vote", { method: "POST", body: { voterToken: "tok", workId: "w1" }, auth: "optional" }],
  ["settleDuelEarly", (api) => api.settleDuelEarly("t1", "d1"), "/arenas/t1/duels/d1/settle", { method: "POST", auth: "required" }],
  ["resolveTiebreak", (api) => api.resolveTiebreak("t1", "d1", "w2"), "/arenas/t1/duels/d1/tiebreak", { method: "POST", body: { winnerWorkId: "w2" }, auth: "required" }],
  ["renameTournament", (api) => api.renameTournament("t1", "New"), "/arenas/t1", { method: "PATCH", body: { name: "New" }, auth: "required" }],
  ["deleteTournament", (api) => api.deleteTournament("t1"), "/arenas/t1", { method: "DELETE", auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder();
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("ids are encoded into one segment", async () => {
  const { calls, api } = recorder();
  await api.voteOnDuel("a/b", "c?d", "tok", "w1");
  assert.equal(calls[0]!.path, "/arenas/a%2Fb/duels/c%3Fd/vote");
});

test("envelopes are unwrapped", async () => {
  assert.equal(await recorder({ tournament: "T" }).api.createTournament({ name: "N", bracketSize: 8, roundDurationMinutes: 60 }), "T");
  assert.equal(await recorder({ tournaments: ["T"] }).api.fetchMyTournaments().then((list) => list[0]), "T");
  assert.equal(await recorder({ tournaments: ["T"] }).api.fetchVotedTournaments().then((list) => list[0]), "T");
  assert.equal(await recorder({ tournament: "V" }).api.fetchTournament("t1"), "V");
});

test("void endpoints resolve undefined", async () => {
  const { api } = recorder({});
  assert.equal(await api.startTournament("t1"), undefined);
  assert.equal(await api.deleteTournament("t1"), undefined);
  assert.equal(await api.voteOnDuel("t1", "d1", "tok", "w1"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, cannot find `./api.js`.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/arena/types.ts`:
```ts
export interface Tournament {
  id: string;
  name: string;
  bracketSize: number;
  roundDurationMinutes: number;
  status: "seeding" | "active" | "completed";
  currentRound: number;
  createdAt: string;
  ownerUserId: string;
  covers: string[];
  filledSlots: number;
  winner: SeedBook | null;
}

export interface TournamentView extends Tournament {
  slots: Array<{ slotIndex: number } & SeedBook>;
  duels: Duel[];
}
```

`packages/shared/src/arena/api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { SeedBook, Tournament, TournamentView } from "./types.js";

export function createArenaApi(request: ApiRequest) {
  return {
    async createTournament(input: { name: string; bracketSize: number; roundDurationMinutes: number }): Promise<Tournament> {
      return (await request<{ tournament: Tournament }>("/arenas", { method: "POST", body: input, auth: "required" })).tournament;
    },
    async fetchMyTournaments(): Promise<Tournament[]> {
      return (await request<{ tournaments: Tournament[] }>("/arenas/mine", { auth: "required" })).tournaments;
    },
    async fetchVotedTournaments(): Promise<Tournament[]> {
      return (await request<{ tournaments: Tournament[] }>("/arenas/voted", { auth: "required" })).tournaments;
    },
    async fetchTournament(id: string, voterToken?: string): Promise<TournamentView> {
      const query = voterToken ? `?voterToken=${encodeURIComponent(voterToken)}` : "";
      return (await request<{ tournament: TournamentView }>(apiPath`/arenas/${id}` + query, { auth: "optional" })).tournament;
    },
    async setTournamentSlots(id: string, slots: Array<{ slotIndex: number; book: SeedBook }>): Promise<void> {
      await request(apiPath`/arenas/${id}/slots`, { method: "PUT", body: { slots }, auth: "required" });
    },
    async randomFillTournament(id: string, pool: SeedBook[]): Promise<void> {
      await request(apiPath`/arenas/${id}/random-fill`, { method: "POST", body: { pool }, auth: "required" });
    },
    async startTournament(id: string): Promise<void> {
      await request(apiPath`/arenas/${id}/start`, { method: "POST", auth: "required" });
    },
    async voteOnDuel(tournamentId: string, duelId: string, voterToken: string, workId: string): Promise<void> {
      await request(apiPath`/arenas/${tournamentId}/duels/${duelId}/vote`, { method: "POST", body: { voterToken, workId }, auth: "optional" });
    },
    async settleDuelEarly(tournamentId: string, duelId: string): Promise<void> {
      await request(apiPath`/arenas/${tournamentId}/duels/${duelId}/settle`, { method: "POST", auth: "required" });
    },
    async resolveTiebreak(tournamentId: string, duelId: string, winnerWorkId: string): Promise<void> {
      await request(apiPath`/arenas/${tournamentId}/duels/${duelId}/tiebreak`, { method: "POST", body: { winnerWorkId }, auth: "required" });
    },
    async renameTournament(id: string, name: string): Promise<void> {
      await request(apiPath`/arenas/${id}`, { method: "PATCH", body: { name }, auth: "required" });
    },
    async deleteTournament(id: string): Promise<void> {
      await request(apiPath`/arenas/${id}`, { method: "DELETE", auth: "required" });
    },
  };
}

export type ArenaApi = ReturnType<typeof createArenaApi>;
```

Add to `packages/shared/src/arena/index.ts`:
```ts
export * from "./api.js";
```

- [ ] **Step 4: Run the checks**

```bash
npm test --workspace @scripta/shared
npm run typecheck --workspace @scripta/shared
npm run build --workspace @scripta/shared
```
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/arena
git commit -m "Share the arena types and endpoints"
```

### Task 5: Web and mobile arena over the factory

**Files:**
- Modify: `frontend/src/api/arena.ts` (full rewrite)
- Modify: `mobile/src/features/arena/api.ts` (full rewrite)
- Modify: `mobile/src/features/arena/ArenaViewScreen.tsx:110`
- Modify: every web and mobile file that imports `TournamentSummary` from an arena API module. Find them with the commands below.

**Interfaces:**
- Consumes:
  - `createArenaApi`, `Tournament`, `TournamentView` (Task 4).
  - Web `request` (Task 2) and mobile `request` (Task 3).
- Produces:
  - The same exported function names as today, from both modules.
  - The arena type is renamed from `TournamentSummary` to `Tournament`.

- [ ] **Step 1: Rewrite the web module**

`frontend/src/api/arena.ts`:
```ts
import { createArenaApi } from "@scripta/shared";
import { request } from "./request";

export type { Duel, DuelSide, SeedBook, Tournament, TournamentView } from "@scripta/shared";

export const {
  createTournament,
  fetchMyTournaments,
  fetchVotedTournaments,
  fetchTournament,
  setTournamentSlots,
  randomFillTournament,
  startTournament,
  voteOnDuel,
  settleDuelEarly,
  resolveTiebreak,
  renameTournament,
  deleteTournament,
} = createArenaApi(request);
```

- [ ] **Step 2: Rewrite the mobile module**

`mobile/src/features/arena/api.ts`. It keeps `resolveCover`, which is a covers call and stays mobile-only:
```ts
import { createArenaApi } from "@scripta/shared";
import { apiClient, request } from "../../core/api";

export type { Tournament, TournamentView } from "@scripta/shared";

export const {
  createTournament,
  fetchMyTournaments,
  fetchVotedTournaments,
  fetchTournament,
  setTournamentSlots,
  randomFillTournament,
  startTournament,
  voteOnDuel,
  settleDuelEarly,
  resolveTiebreak,
  renameTournament,
  deleteTournament,
} = createArenaApi(request);

export async function resolveCover(book: Record<string, unknown>): Promise<string | null> {
  const query = new URLSearchParams();
  const isbn = String(book.ISBN ?? "").trim();
  const imageId = String(book.ImageId ?? "").trim();
  const title = String(book.Title ?? "").trim();
  const author = String(book.Attribution ?? "").trim();
  if (isbn) query.set("isbn", isbn);
  if (imageId) query.set("imageId", imageId);
  if (title) query.set("title", title);
  if (author) query.set("author", author);
  return (await apiClient.request<{ url: string | null }>(`/covers/resolve?${query}`, { auth: true })).url;
}
```

- [ ] **Step 3: Fix the call sites**

1. **Mobile `createTournament` callers.** Find them:
   ```bash
   rg -n "createTournament\(" mobile/src
   ```
   Change each one from positional arguments to an object, `createTournament({ name, bracketSize, roundDurationMinutes })`.

2. **Mobile vote call.** In `mobile/src/features/arena/ArenaViewScreen.tsx:110`, drop the last argument:
   ```ts
   voteOnDuel(id, next.id, token, workId)
   ```
   That is, remove `, Boolean(user)`. If `user` is now unused in that file, remove its binding.

3. **The renamed arena type.** Find every arena `TournamentSummary` import, leaving out community's:
   ```bash
   rg -n "TournamentSummary" frontend/src mobile/src | rg -v "@scripta/shared/community"
   ```
   For each hit that imports from `api/arena`, `features/arena/api`, or `./api` inside `features/arena`, rename the import and every use to `Tournament`. A file that imports both community's `TournamentSummary` and the arena one keeps community's under its own name.

4. **Typecheck to catch the rest.**
   ```bash
   npm run typecheck --workspace frontend
   EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile
   ```
   Fix any remaining errors at the call site.
   - Web code may now see `covers`, `filledSlots` and `winner`. That's expected: they are always sent.
   - Don't widen the shared types to make an error go away.

- [ ] **Step 4: Run the full client checks**

```bash
npm test --workspace frontend
npm run lint --workspace frontend
npm run typecheck --workspace frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile
```
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src mobile/src
git commit -m "Serve arena on both clients from the shared factory

GET /arenas/:id now sends the viewer's token when one is held, so a
signed-in viewer's \"you voted\" badges reflect the account."
```

### Task 6: Backend arena adopts the shared types

**Files:**
- Modify: `backend/src/modules/arena/service.ts:34-85`, plus the type uses listed below
- Modify: `backend/src/modules/arena/wire.ts`
- Modify: `backend/src/modules/arena/service.test.ts:27,316`
- Modify: `backend/src/modules/arena/routes.ts:71-72`

**Interfaces:**
- Consumes: `SeedBook`, `DuelSide`, `Duel`, `Tournament`, `TournamentView` from `@scripta/shared`.
- Produces:
  - `arena/service.ts` re-exports `SeedBook`, `DuelSide`, `Duel`, `Tournament` and `TournamentView`.
  - `SeedBookView`, `DuelSideView`, `DuelView` and arena's `TournamentSummary` no longer exist in the backend.

- [ ] **Step 1: Replace the declarations in `service.ts`**

Delete the interfaces `SeedBookView`, `TournamentSummary`, `DuelSideView`, `DuelView` and `TournamentView` (`service.ts:34-85`). Keep `TournamentDiscoverRef`. Put this in their place:
```ts
import type { Duel, DuelSide, SeedBook, Tournament, TournamentView } from "@scripta/shared";

export type { Duel, DuelSide, SeedBook, Tournament, TournamentView };
```
Move the `import type` line up with the other imports at the top of the file.

- [ ] **Step 2: Rename the uses inside the arena module only**

```bash
sed -i '' -e 's/\bSeedBookView\b/SeedBook/g' -e 's/\bDuelSideView\b/DuelSide/g' -e 's/\bDuelView\b/Duel/g' -e 's/\bTournamentSummary\b/Tournament/g' backend/src/modules/arena/service.ts backend/src/modules/arena/wire.ts backend/src/modules/arena/service.test.ts
```

Do not touch `backend/src/modules/community/service.ts`: its `TournamentSummary` is community's feed-card type.

Then check what's left:
```bash
rg -n "SeedBookView|DuelSideView|DuelView|TournamentSummary" backend/src/modules/arena
```
Expected: no output.

- [ ] **Step 3: Annotate the wire builders**

In `backend/src/modules/arena/wire.ts`:
- Change the import to:
  ```ts
  import type { Duel, DuelSide, SeedBook, Tournament, TournamentView } from "@scripta/shared";
  ```
- Add return types:
  - `bookForWire(...): SeedBook`
  - `sideForWire(...): DuelSide`
  - `duelForWire(...): Duel`
  - `summaryForWire<T extends Tournament>(...): T`
  - `summariesForWire(...): Tournament[]`
  - `tournamentForWire(...): TournamentView`

In `backend/src/modules/arena/routes.ts`, the `POST /arenas` handler (`:71`), change the send to:
```ts
return reply.code(201).send({ tournament: tournament satisfies Tournament });
```
and import `type Tournament` from `./service.js`.

- [ ] **Step 4: Run the backend checks**

```bash
npm run typecheck --workspace backend
npm test --workspace backend
```
Expected: exit 0. If typecheck fails because a backend field differs from the shared type, the shared type was meant to match the backend (spec, "Shared types"). Report the field rather than casting it.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/arena
git commit -m "Check the arena wire answers against the shared types"
```

### Task 7: Phase 1 gate

- [ ] **Step 1: Run the whole CI sequence locally**

```bash
npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile && npm run test:scripts
```
Expected: exit 0.

- [ ] **Step 2: Run the `security-review` skill on the branch**

This phase changes which arena requests carry a token. Fix any finding before pushing.

- [ ] **Step 3: Ship with the `ship` skill**

Push `claude/shared-feature-apis`, open PR 1 against `main` titled "Shared feature APIs 1/5: request port and arena", and turn auto-merge on. Do not deploy.

---

## Phase 2 — tierlists (PR 2, branch `claude/shared-feature-apis-2-tierlists`, stacked on PR 1)

Before Task 8, create the branch:
```bash
git switch -c claude/shared-feature-apis-2-tierlists
```

### Task 8: Shared public book types, tierlists types and `createTierlistsApi`

**Files:**
- Create: `packages/shared/src/public/types.ts`
- Create: `packages/shared/src/public/index.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/tierlists/types.ts`
- Create: `packages/shared/src/tierlists/api.ts`
- Modify: `packages/shared/src/tierlists/index.ts`
- Test: `packages/shared/src/tierlists/api.test.ts`

**Interfaces:**
- Produces:
  - `PublicBookData` and `PublicHighlight`, exported from `@scripta/shared`.
  - `Tierlist`, `VotingBoard`, `BallotResponse` and `VotedTierlist`.
  - `createTierlistsApi(request)`, returning:
    - `fetchTierlists(): Promise<Tierlist[]>`
    - `fetchTierlist(id): Promise<Tierlist>`
    - `createTierlist(name: string, data?: TierlistData, access?: "anonymous" | "members"): Promise<Tierlist>`
    - `updateTierlist(id, patch: { name?: string; data?: TierlistData }): Promise<Tierlist>`
    - `deleteTierlist(id): Promise<void>`
    - `fetchVotedTierlists(): Promise<VotedTierlist[]>`
    - `fetchVotingBoard(code): Promise<{ board: VotingBoard; books: PublicBookData[] }>`
    - `submitBallot(code, placements: Placement[], ballotId: string | null): Promise<BallotResponse>`
    - `fetchBallot(code, ballotId: string): Promise<BallotResponse>`
    - `fetchMyBallot(code): Promise<BallotResponse>`
    - `fetchTierlistResults(id): Promise<{ histogram: HistogramCell[]; ballotCount: number }>`
    - `openVoting(id, access: "anonymous" | "members"): Promise<{ tierlist: Tierlist; voteCode: string }>`
    - `setVotingState(id, patch: { access?: "anonymous" | "members"; open?: boolean }): Promise<Tierlist>`
  - `type TierlistsApi`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tierlists/api.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createTierlistsApi, type TierlistsApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createTierlistsApi(request) };
}

const data = { tiers: [], pool: ["w1"] };
const placements = [{ workId: "w1", tierId: "s" }];

const cases: Array<[string, (api: TierlistsApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchTierlists", (api) => api.fetchTierlists(), "/tierlists", { auth: "required" }],
  ["fetchTierlist", (api) => api.fetchTierlist("t1"), "/tierlists/t1", { auth: "required" }],
  ["createTierlist", (api) => api.createTierlist("N", data, "members"), "/tierlists", { method: "POST", body: { name: "N", data, access: "members" }, auth: "required" }],
  ["updateTierlist", (api) => api.updateTierlist("t1", { name: "M" }), "/tierlists/t1", { method: "PUT", body: { name: "M" }, auth: "required" }],
  ["deleteTierlist", (api) => api.deleteTierlist("t1"), "/tierlists/t1", { method: "DELETE", auth: "required" }],
  ["fetchVotedTierlists", (api) => api.fetchVotedTierlists(), "/tierlists/voted", { auth: "required" }],
  ["fetchVotingBoard", (api) => api.fetchVotingBoard("c1"), "/tierlists/voting/c1", { auth: "none" }],
  ["submitBallot new", (api) => api.submitBallot("c1", placements, null), "/tierlists/voting/c1/ballot", { method: "POST", body: { placements }, auth: "optional" }],
  ["submitBallot edit", (api) => api.submitBallot("c1", placements, "b1"), "/tierlists/voting/c1/ballot/b1", { method: "PUT", body: { placements }, auth: "optional" }],
  ["fetchBallot", (api) => api.fetchBallot("c1", "b1"), "/tierlists/voting/c1/ballot/b1", { auth: "optional" }],
  ["fetchMyBallot", (api) => api.fetchMyBallot("c1"), "/tierlists/voting/c1/ballot", { auth: "optional" }],
  ["fetchTierlistResults", (api) => api.fetchTierlistResults("t1"), "/tierlists/t1/results", { auth: "required" }],
  ["openVoting", (api) => api.openVoting("t1", "anonymous"), "/tierlists/t1/open-voting", { method: "POST", body: { access: "anonymous" }, auth: "required" }],
  ["setVotingState", (api) => api.setVotingState("t1", { open: false }), "/tierlists/t1/voting", { method: "PUT", body: { open: false }, auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder();
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("codes and ids are encoded into one segment", async () => {
  const { calls, api } = recorder();
  await api.fetchBallot("a/b", "c#d");
  assert.equal(calls[0]!.path, "/tierlists/voting/a%2Fb/ballot/c%23d");
});

test("envelopes are unwrapped where the backend wraps", async () => {
  assert.equal(await recorder({ tierlists: ["L"] }).api.fetchTierlists().then((list) => list[0]), "L");
  assert.equal(await recorder({ tierlists: ["V"] }).api.fetchVotedTierlists().then((list) => list[0]), "V");
  assert.equal(await recorder({ tierlist: "T" }).api.setVotingState("t1", {}), "T");
  assert.deepEqual(await recorder({ board: "B", books: [] }).api.fetchVotingBoard("c1"), { board: "B", books: [] });
});

test("void endpoints resolve undefined", async () => {
  assert.equal(await recorder({}).api.deleteTierlist("t1"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, cannot find `./api.js`.

- [ ] **Step 3: Implement**

`packages/shared/src/public/types.ts`:
```ts
export interface PublicBookData {
  key: string;
  workId: string | null;
  title: string;
  author: string;
  isbn: string | null;
  imageId: string | null;
  coverUrl: string | null;
  readStatus: number | null;
}

export interface PublicHighlight {
  bookKey: string;
  highlightId: string;
  text: string;
  annotation: string | null;
}
```

`packages/shared/src/public/index.ts`:
```ts
export * from "./types.js";
```

In `packages/shared/src/index.ts`, add:
```ts
export * from "./public/index.js";
```

Append to `packages/shared/src/tierlists/types.ts`:
```ts
export interface Tierlist {
  id: string;
  name: string;
  data: TierlistData;
  createdAt: string;
  updatedAt: string;
  voteCode: string | null;
  voteAccess: "anonymous" | "members";
  votingOpen: boolean;
  sourceTierlistId: string | null;
  promotedAt: string | null;
  originCreatorId: string;
}

export interface VotingBoard {
  name: string;
  tiers: Array<{ id: string; label: string; color: string }>;
  pool: string[];
  access: "anonymous" | "members";
  votingOpen: boolean;
  ballotCount: number;
  eligibleVoteCount: number;
  promotedAt: string | null;
  histogram?: HistogramCell[];
}

export interface BallotResponse {
  ballotId: string;
  placements: Placement[];
  results: { histogram: HistogramCell[]; ballotCount: number };
}

export interface VotedTierlist {
  id: string;
  ownerUserId: string;
  createdAt: string;
  voteCode: string;
  name: string;
  poolSize: number;
  ballotCount: number;
  eligibleVoteCount: number;
  promotedAt: string | null;
  votingOpen: boolean;
  covers: string[];
}
```
and add these imports to the top of that file:
```ts
import type { Placement } from "./ballot.js";
import type { HistogramCell } from "./results.js";
```

`packages/shared/src/tierlists/api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { PublicBookData } from "../public/types.js";
import type { Placement } from "./ballot.js";
import type { HistogramCell } from "./results.js";
import type { BallotResponse, Tierlist, TierlistData, VotedTierlist, VotingBoard } from "./types.js";

type Access = "anonymous" | "members";

export function createTierlistsApi(request: ApiRequest) {
  return {
    async fetchTierlists(): Promise<Tierlist[]> {
      return (await request<{ tierlists: Tierlist[] }>("/tierlists", { auth: "required" })).tierlists;
    },
    fetchTierlist(id: string): Promise<Tierlist> {
      return request<Tierlist>(apiPath`/tierlists/${id}`, { auth: "required" });
    },
    createTierlist(name: string, data?: TierlistData, access?: Access): Promise<Tierlist> {
      return request<Tierlist>("/tierlists", { method: "POST", body: { name, data, access }, auth: "required" });
    },
    updateTierlist(id: string, patch: { name?: string; data?: TierlistData }): Promise<Tierlist> {
      return request<Tierlist>(apiPath`/tierlists/${id}`, { method: "PUT", body: patch, auth: "required" });
    },
    async deleteTierlist(id: string): Promise<void> {
      await request(apiPath`/tierlists/${id}`, { method: "DELETE", auth: "required" });
    },
    async fetchVotedTierlists(): Promise<VotedTierlist[]> {
      return (await request<{ tierlists: VotedTierlist[] }>("/tierlists/voted", { auth: "required" })).tierlists;
    },
    fetchVotingBoard(code: string): Promise<{ board: VotingBoard; books: PublicBookData[] }> {
      return request(apiPath`/tierlists/voting/${code}`, { auth: "none" });
    },
    submitBallot(code: string, placements: Placement[], ballotId: string | null): Promise<BallotResponse> {
      const path = ballotId === null ? apiPath`/tierlists/voting/${code}/ballot` : apiPath`/tierlists/voting/${code}/ballot/${ballotId}`;
      return request<BallotResponse>(path, { method: ballotId === null ? "POST" : "PUT", body: { placements }, auth: "optional" });
    },
    fetchBallot(code: string, ballotId: string): Promise<BallotResponse> {
      return request<BallotResponse>(apiPath`/tierlists/voting/${code}/ballot/${ballotId}`, { auth: "optional" });
    },
    fetchMyBallot(code: string): Promise<BallotResponse> {
      return request<BallotResponse>(apiPath`/tierlists/voting/${code}/ballot`, { auth: "optional" });
    },
    fetchTierlistResults(id: string): Promise<{ histogram: HistogramCell[]; ballotCount: number }> {
      return request(apiPath`/tierlists/${id}/results`, { auth: "required" });
    },
    openVoting(id: string, access: Access): Promise<{ tierlist: Tierlist; voteCode: string }> {
      return request(apiPath`/tierlists/${id}/open-voting`, { method: "POST", body: { access }, auth: "required" });
    },
    async setVotingState(id: string, patch: { access?: Access; open?: boolean }): Promise<Tierlist> {
      return (await request<{ tierlist: Tierlist }>(apiPath`/tierlists/${id}/voting`, { method: "PUT", body: patch, auth: "required" })).tierlist;
    },
  };
}

export type TierlistsApi = ReturnType<typeof createTierlistsApi>;
```

Add to `packages/shared/src/tierlists/index.ts`:
```ts
export * from "./api.js";
```

- [ ] **Step 4: Run the checks**

```bash
npm test --workspace @scripta/shared
npm run typecheck --workspace @scripta/shared
npm run build --workspace @scripta/shared
```
Expected: PASS and exit 0. Shared `fetchTierlists`, `createTierlist` and the others don't clash with any existing root export; the build would fail if one did.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "Share the tier list types and endpoints"
```

### Task 9: Web and mobile tierlists over the factory

**Files:**
- Modify: `frontend/src/api/tierlists.ts` (full rewrite)
- Modify: `frontend/src/api/tierlistVoting.ts` (full rewrite)
- Modify: `frontend/src/hooks/useTierlistVoting.ts:38`
- Modify: `frontend/src/api/sharedMurals.ts` (types re-exported from shared)
- Modify: `mobile/src/features/tierlists/api.ts` (full rewrite)
- Modify: `mobile/src/features/tierlists/VoteTierlistScreen.tsx:14,71,84,104`
- Modify: `mobile/src/features/public/api.ts` (types re-exported from shared)

**Interfaces:**
- Consumes: `createTierlistsApi`, `PublicBookData` and `PublicHighlight` (Task 8), plus both `request` adapters.
- Produces:
  - **Web:** today's names, plus `fetchBallot` and `fetchMyBallot`. `fetchBallotApi` is removed.
  - **Mobile:** today's names. `PublicBook` is removed in favour of `PublicBookData`.

- [ ] **Step 1: Rewrite the web modules**

`frontend/src/api/tierlists.ts`:
```ts
import { createTierlistsApi } from "@scripta/shared";
import { request } from "./request";

export type { ResolvedTierlist, TierDefinition, Tierlist, TierlistData } from "@scripta/shared";

export const {
  fetchTierlists,
  fetchTierlist,
  createTierlist: createTierlistApi,
  updateTierlist: updateTierlistApi,
  deleteTierlist: deleteTierlistApi,
} = createTierlistsApi(request);
```

`frontend/src/api/tierlistVoting.ts`:
```ts
import { createTierlistsApi } from "@scripta/shared";
import { request } from "./request";

export type { BallotResponse, HistogramCell, VotedTierlist, VotingBoard } from "@scripta/shared";

export const {
  fetchVotedTierlists,
  fetchVotingBoard,
  submitBallot: submitBallotApi,
  fetchBallot,
  fetchMyBallot,
  fetchTierlistResults: fetchTierlistResultsApi,
  openVoting: openVotingApi,
  setVotingState: setVotingStateApi,
} = createTierlistsApi(request);
```

In `frontend/src/hooks/useTierlistVoting.ts`:
- Change the import of `fetchBallotApi` to `fetchBallot, fetchMyBallot`.
- Change line 38 to:
  ```ts
  queryFn: () => (storedBallotId === null ? fetchMyBallot(code) : fetchBallot(code, storedBallotId)),
  ```

In `frontend/src/api/sharedMurals.ts`, delete the `PublicBookData` and `PublicHighlight` interfaces and add:
```ts
export type { PublicBookData, PublicHighlight } from "@scripta/shared";
```
Leave the rest of that file for Task 16.

Web code that read voting-board `books` as `Record<string, unknown>` now gets `PublicBookData`. Fix any typecheck errors at those call sites by reading the typed fields. Find them with:
```bash
rg -n "fetchVotingBoard|\.books" frontend/src/hooks/useTierlistVoting.ts frontend/src/pages
```

- [ ] **Step 2: Rewrite the mobile module**

`mobile/src/features/tierlists/api.ts`:
```ts
import { createTierlistsApi } from "@scripta/shared";
import { File, Paths } from "expo-file-system";
import { apiClient, request } from "../../core/api";

export type { BallotResponse, Tierlist, VotedTierlist, VotingBoard } from "@scripta/shared";

export const {
  fetchTierlists,
  createTierlist,
  updateTierlist,
  deleteTierlist,
  fetchVotedTierlists,
  fetchVotingBoard,
  submitBallot,
  fetchBallot,
  fetchMyBallot,
  openVoting,
  setVotingState,
  fetchTierlistResults,
} = createTierlistsApi(request);

export async function renderTierlistShareVideo(id: string, imageUri: string) {
  const form = new FormData();
  form.append("image", new File(imageUri));
  const { base64 } = await apiClient.request<{ base64: string }>(`/tierlists/${encodeURIComponent(id)}/share-video`, { method: "POST", body: form, auth: true });
  const file = new File(Paths.cache, `tierlist-${id}-${Date.now()}.mp4`);
  file.create();
  file.write(base64, { encoding: "base64" });
  return file.uri;
}
```

In `mobile/src/features/public/api.ts`, delete the `PublicBookData` and `PublicHighlight` interfaces and add:
```ts
export type { PublicBookData, PublicHighlight } from "@scripta/shared";
```
Leave the rest for Task 16.

In `mobile/src/features/tierlists/VoteTierlistScreen.tsx`:
- **`:14`:** import `type PublicBookData` from `@scripta/shared` in place of `type PublicBook` from `./api`, and rename every use of `PublicBook` in the file.
- **`:71`:** `const request = user ? fetchMyBallot(code) : fetchBallot(code, storedId!);`
- **`:84`:** drop the trailing `, false` from the `fetchBallot(...)` call.
- **`:104`:** `submitBallot(code, placements, ballot?.ballotId ?? null)`

- [ ] **Step 3: Typecheck and fix the remaining call sites**

```bash
npm run typecheck --workspace frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile
```
Fix the errors at the call site. The typical one is mobile `PublicBook.author?` becoming `PublicBookData.author: string`, with `isbn` and `imageId` now `string | null`. Don't widen the shared types.

- [ ] **Step 4: Run the full client checks**

```bash
npm test --workspace frontend
npm run lint --workspace frontend
npm run typecheck --workspace frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile
```
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src mobile/src
git commit -m "Serve tier lists on both clients from the shared factory"
```

### Task 10: Backend tierlists adopts the shared types

**Files:**
- Modify: `backend/src/modules/tierlists/wire.ts`
- Modify: `backend/src/modules/tierlists/routes.ts`: `answer()` at `:60`, and the inline answers at `:105`, `:142`, `:177`, `:200`, `:220`, `:297-310`, `:375-379`
- Modify: `backend/src/modules/tierlists/domain/types.ts` (`HistogramCell` at `:79`, `Placement` at `:71`)
- Modify: `backend/src/modules/tierlists/service.ts:448` (`TierlistData`), plus every backend import of it
- Modify: `backend/src/modules/tierlists/service.ts:62-74` (`PublishedTierlistRef`)
- Modify: `backend/src/modules/library/publicResolver.ts:8-25` (`PublicBookData`, `PublicHighlight`)

**Interfaces:**
- Consumes, from `@scripta/shared`: `TierlistData`, `TierDefinition`, `ResolvedTierlist`, `HistogramCell`, `Placement`, `Tierlist`, `VotingBoard`, `BallotResponse`, `VotedTierlist`, `PublicBookData` and `PublicHighlight`.
- Produces:
  - Backend `WorksBoard`, `WorksTier`, `TierlistData`, `HistogramCell`, `Placement`, `PublicBookData` and `PublicHighlight` are now the shared types.
  - Backend `TierlistData` becomes shared `ResolvedTierlist`.

- [ ] **Step 1: Swap the identical copies for re-exports**

1. **`domain/types.ts`.** Replace the `HistogramCell` and `Placement` interfaces with:
   ```ts
   export type { HistogramCell, Placement } from "@scripta/shared";
   ```

2. **`wire.ts`.**
   - Delete `WorksTier` and `WorksBoard`.
   - Import `type TierlistData` and `type TierDefinition` from `@scripta/shared`.
   - Rename `WorksBoard` to `TierlistData` and `WorksTier` to `TierDefinition` throughout `wire.ts` and `routes.ts`. Find them with:
     ```bash
     rg -n "WorksBoard|WorksTier" backend/src
     ```
   - Annotate `histogramToWorks(...): HistogramCell[]` and `placementsToWorks(...): Placement[]`.

3. **`service.ts:448`.** Delete the backend `TierlistData` and use shared `ResolvedTierlist`:
   ```bash
   rg -n "\bTierlistData\b" backend/src
   ```
   - Each backend import of tierlists' own `TierlistData` (through `tierlists/index.js` or `./service.js`) becomes `import type { ResolvedTierlist } from "@scripta/shared"`, and its uses are renamed.
   - Do not rename shared `TierlistData` imports that come from `@scripta/shared`.
   - Remove the export from `tierlists/index.ts` if it re-exported it.

4. **`publicResolver.ts:8-25`.** Replace the two interfaces with:
   ```ts
   import type { PublicBookData, PublicHighlight } from "@scripta/shared";
   export type { PublicBookData, PublicHighlight };
   ```

- [ ] **Step 2: Annotate the answers**

In `routes.ts`:
- **Import:**
  ```ts
  import type { BallotResponse, Tierlist as WireTierlist, VotingBoard, PublicBookData } from "@scripta/shared";
  ```
- **`answer`:**
  ```ts
  function answer(tierlist: Tierlist): WireTierlist {
    return { ...tierlist, data: canonicalBoard(tierlist.data) };
  }
  ```
- **The other answers:** where a route sends `{ ...tierlist, data: … }` (create `:105`, open-voting `:177`, voting `:200`), apply `satisfies WireTierlist` to that object.
- **Voting board (`:297-310`):** apply `satisfies VotingBoard` to the `board: { … }` object.
- **`booksInOrder`:** annotate it as `PublicBookData[]`. `resolvePublicBooksByWork` already returns these.
- **`sendBallotOutcome`:** apply `satisfies BallotResponse` to its sent object.

In `wire.ts`, `boardBooks` changes:
- Its signature becomes `boardBooks(pool: string[], snapshot: unknown[] | null, live: () => PublicBookData[]): PublicBookData[]`.
- The snapshot branch casts once, at the point where it reads the stored JSON:
  ```ts
  const entries = snapshot.filter((book): book is PublicBookData => typeof book === "object" && book !== null);
  ```
  and `byWork` becomes `Map<string, PublicBookData>`.

In `service.ts`, add `satisfies VotedTierlist` where `listVotedByUser`'s rows reach the route. If `PublishedTierlistRef` already has exactly the `VotedTierlist` fields, declare `listVotedByUser(...): VotedTierlist[]` instead.

- [ ] **Step 3: Run the backend checks**

```bash
npm run typecheck --workspace backend
npm test --workspace backend
```
Expected: exit 0. A mismatch means a shared type differs from what the backend sends. Fix the shared type only if the spec's types table says it should match, and report it.

- [ ] **Step 4: Commit**

```bash
git add backend/src
git commit -m "Check the tier list wire answers against the shared types"
```

### Task 11: Phase 2 gate

- [ ] **Step 1:** Run the same full CI sequence as Task 7, Step 1. Expected: exit 0.
- [ ] **Step 2:** Run the `security-review` skill. Ballots now follow the "token if held" rule on mobile.
- [ ] **Step 3:** Use the `ship` skill. Push `claude/shared-feature-apis-2-tierlists`, open PR 2 with base `claude/shared-feature-apis`, title it "Shared feature APIs 2/5: tier lists", and turn auto-merge on.

---

## Phase 3 — quizzes (PR 3, branch `claude/shared-feature-apis-3-quizzes`, stacked on PR 2)

```bash
git switch -c claude/shared-feature-apis-3-quizzes
```

### Task 12: Shared quizzes types and `createQuizzesApi`

**Files:**
- Modify: `packages/shared/src/quizzes/types.ts`
- Create: `packages/shared/src/quizzes/api.ts`
- Modify: `packages/shared/src/quizzes/index.ts`
- Test: `packages/shared/src/quizzes/api.test.ts`

**Interfaces:**
- Produces:
  - Types `Quiz`, `PlayBoard`, `PlayResponse`, `PublicResultPlay` and `PlaySubmission`.
  - `createQuizzesApi(request)`, returning:
    - `fetchQuizzes(): Promise<Quiz[]>`
    - `fetchQuiz(id): Promise<Quiz>`
    - `createQuiz(name: string, data: QuizDataInput): Promise<Quiz>`
    - `updateQuiz(id, patch: { name?: string; data?: QuizData }): Promise<Quiz>`
    - `deleteQuiz(id): Promise<void>`
    - `publishQuiz(id): Promise<{ quiz: Quiz; voteCode: string }>`
    - `setPlayState(id, open: boolean): Promise<Quiz>`
    - `fetchQuizResults(id): Promise<{ plays: ResultPlay[]; stats: QuestionStat[]; questionCount: number }>`
    - `fetchPlayBoard(code): Promise<PlayBoard>`
    - `submitPlay(code, body: PlaySubmission): Promise<PlayResponse>`
    - `fetchPlay(code, playId: string | null): Promise<PlayResponse>`
    - `fetchPublicResults(code): Promise<{ plays: PublicResultPlay[]; questionCount: number }>`
  - `type QuizzesApi`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/quizzes/api.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createQuizzesApi, type QuizzesApi } from "./api.js";
import type { QuizDataInput } from "./types.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createQuizzesApi(request) };
}

const input = {} as QuizDataInput;
const submission = { answers: [{ questionId: "q1", choiceIndex: 0 }], durationMs: 1000 };

const cases: Array<[string, (api: QuizzesApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchQuizzes", (api) => api.fetchQuizzes(), "/quizzes", { auth: "required" }],
  ["fetchQuiz", (api) => api.fetchQuiz("q1"), "/quizzes/q1", { auth: "required" }],
  ["createQuiz", (api) => api.createQuiz("N", input), "/quizzes", { method: "POST", body: { name: "N", data: input }, auth: "required" }],
  ["updateQuiz", (api) => api.updateQuiz("q1", { name: "M" }), "/quizzes/q1", { method: "PUT", body: { name: "M" }, auth: "required" }],
  ["deleteQuiz", (api) => api.deleteQuiz("q1"), "/quizzes/q1", { method: "DELETE", auth: "required" }],
  ["publishQuiz sends no body", (api) => api.publishQuiz("q1"), "/quizzes/q1/publish", { method: "POST", auth: "required" }],
  ["setPlayState", (api) => api.setPlayState("q1", true), "/quizzes/q1/voting", { method: "PUT", body: { open: true }, auth: "required" }],
  ["fetchQuizResults", (api) => api.fetchQuizResults("q1"), "/quizzes/q1/results", { auth: "required" }],
  ["fetchPlayBoard", (api) => api.fetchPlayBoard("c1"), "/quizzes/voting/c1", { auth: "none" }],
  ["submitPlay", (api) => api.submitPlay("c1", submission), "/quizzes/voting/c1/play", { method: "POST", body: submission, auth: "optional" }],
  ["fetchPlay own", (api) => api.fetchPlay("c1", null), "/quizzes/voting/c1/play", { auth: "optional" }],
  ["fetchPlay by id", (api) => api.fetchPlay("c1", "p1"), "/quizzes/voting/c1/play/p1", { auth: "optional" }],
  ["fetchPublicResults", (api) => api.fetchPublicResults("c1"), "/quizzes/voting/c1/results", { auth: "none" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder();
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("codes and ids are encoded into one segment", async () => {
  const { calls, api } = recorder();
  await api.fetchPlay("a b", "c/d");
  assert.equal(calls[0]!.path, "/quizzes/voting/a%20b/play/c%2Fd");
});

test("envelopes are unwrapped where the backend wraps", async () => {
  assert.equal(await recorder({ quizzes: ["Q"] }).api.fetchQuizzes().then((list) => list[0]), "Q");
  assert.equal(await recorder({ quiz: "Q" }).api.setPlayState("q1", false), "Q");
  assert.equal(await recorder({ board: "B" }).api.fetchPlayBoard("c1"), "B");
});

test("void endpoints resolve undefined", async () => {
  assert.equal(await recorder({}).api.deleteQuiz("q1"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, cannot find `./api.js`.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/quizzes/types.ts`:
```ts
export interface Quiz {
  id: string;
  name: string;
  data: QuizData;
  voteCode: string | null;
  playOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlayBoard {
  name: string;
  sourceLabel: string;
  questionCount: number;
  playOpen: boolean;
  playCount: number;
  questions: PublicQuizQuestion[];
}

export interface PlayResponse {
  playId: string;
  score: number;
  correct: Record<string, boolean>;
}

export type PublicResultPlay = Omit<ResultPlay, "playId">;

export interface PlaySubmission {
  answers: Array<{ questionId: string; choiceIndex: number }>;
  durationMs: number;
  playerName?: string;
}
```
`QuizData`, `PublicQuizQuestion` and `ResultPlay` are already declared in this file. Check that they're in scope, and import them only if they come from a sibling file.

`packages/shared/src/quizzes/api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { PlayBoard, PlayResponse, PlaySubmission, PublicResultPlay, QuestionStat, Quiz, QuizData, QuizDataInput, ResultPlay } from "./types.js";

export function createQuizzesApi(request: ApiRequest) {
  return {
    async fetchQuizzes(): Promise<Quiz[]> {
      return (await request<{ quizzes: Quiz[] }>("/quizzes", { auth: "required" })).quizzes;
    },
    fetchQuiz(id: string): Promise<Quiz> {
      return request<Quiz>(apiPath`/quizzes/${id}`, { auth: "required" });
    },
    createQuiz(name: string, data: QuizDataInput): Promise<Quiz> {
      return request<Quiz>("/quizzes", { method: "POST", body: { name, data }, auth: "required" });
    },
    updateQuiz(id: string, patch: { name?: string; data?: QuizData }): Promise<Quiz> {
      return request<Quiz>(apiPath`/quizzes/${id}`, { method: "PUT", body: patch, auth: "required" });
    },
    async deleteQuiz(id: string): Promise<void> {
      await request(apiPath`/quizzes/${id}`, { method: "DELETE", auth: "required" });
    },
    publishQuiz(id: string): Promise<{ quiz: Quiz; voteCode: string }> {
      return request(apiPath`/quizzes/${id}/publish`, { method: "POST", auth: "required" });
    },
    async setPlayState(id: string, open: boolean): Promise<Quiz> {
      return (await request<{ quiz: Quiz }>(apiPath`/quizzes/${id}/voting`, { method: "PUT", body: { open }, auth: "required" })).quiz;
    },
    fetchQuizResults(id: string): Promise<{ plays: ResultPlay[]; stats: QuestionStat[]; questionCount: number }> {
      return request(apiPath`/quizzes/${id}/results`, { auth: "required" });
    },
    async fetchPlayBoard(code: string): Promise<PlayBoard> {
      return (await request<{ board: PlayBoard }>(apiPath`/quizzes/voting/${code}`, { auth: "none" })).board;
    },
    submitPlay(code: string, body: PlaySubmission): Promise<PlayResponse> {
      return request<PlayResponse>(apiPath`/quizzes/voting/${code}/play`, { method: "POST", body, auth: "optional" });
    },
    fetchPlay(code: string, playId: string | null): Promise<PlayResponse> {
      const path = playId === null ? apiPath`/quizzes/voting/${code}/play` : apiPath`/quizzes/voting/${code}/play/${playId}`;
      return request<PlayResponse>(path, { auth: "optional" });
    },
    fetchPublicResults(code: string): Promise<{ plays: PublicResultPlay[]; questionCount: number }> {
      return request(apiPath`/quizzes/voting/${code}/results`, { auth: "none" });
    },
  };
}

export type QuizzesApi = ReturnType<typeof createQuizzesApi>;
```

Add to `packages/shared/src/quizzes/index.ts`:
```ts
export * from "./api.js";
```

- [ ] **Step 4: Run the checks**

```bash
npm test --workspace @scripta/shared
npm run typecheck --workspace @scripta/shared
npm run build --workspace @scripta/shared
```
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/quizzes
git commit -m "Share the quiz types and endpoints"
```

### Task 13: Clients and backend quizzes over the shared types

**Files:**
- Modify: `frontend/src/api/quizzes.ts` (full rewrite)
- Modify: `mobile/src/features/quizzes/api.ts` (full rewrite)
- Modify: `mobile/src/features/quizzes/QuizPlayScreen.tsx:35,45,70,79`
- Modify: `backend/src/modules/quizzes/service.ts:66-73` (`PlayBoard`)
- Modify: `backend/src/modules/quizzes/wire.ts:16` (`quizToWorks`)
- Modify: `backend/src/modules/quizzes/routes.ts:244` (play answer)

**Interfaces:**
- Consumes: `createQuizzesApi` and the quiz types (Task 12).
- Produces:
  - **Web:** today's names.
  - **Mobile:** today's names. `SubmissionBody` is renamed to shared `PlaySubmission`, and `fetchPlayBoard` now resolves the board itself.

- [ ] **Step 1: Rewrite the web module**

`frontend/src/api/quizzes.ts`:
```ts
import { createQuizzesApi } from "@scripta/shared";
import { request } from "./request";

export type { PlayBoard, PlayResponse, PublicQuizQuestion, QuestionStat, Quiz, QuizData, ResultPlay } from "@scripta/shared";

export const {
  fetchQuizzes,
  fetchQuiz,
  createQuiz: createQuizApi,
  updateQuiz: updateQuizApi,
  deleteQuiz: deleteQuizApi,
  publishQuiz: publishQuizApi,
  setPlayState: setPlayStateApi,
  fetchQuizResults: fetchQuizResultsApi,
  fetchPlayBoard,
  submitPlay: submitPlayApi,
  fetchPlay: fetchPlayApi,
  fetchPublicResults: fetchPublicResultsApi,
} = createQuizzesApi(request);
```

- [ ] **Step 2: Rewrite the mobile module and fix the play screen**

`mobile/src/features/quizzes/api.ts`:
```ts
import { createQuizzesApi } from "@scripta/shared";
import { request } from "../../core/api";

export type { PlayBoard, PlayResponse, PlaySubmission, PublicResultPlay, Quiz } from "@scripta/shared";

export const {
  fetchQuizzes,
  fetchQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  publishQuiz,
  setPlayState,
  fetchQuizResults,
  fetchPlayBoard,
  submitPlay,
  fetchPlay,
  fetchPublicResults,
} = createQuizzesApi(request);
```

Find any uses of the old type name:
```bash
rg -n "SubmissionBody" mobile/src
```
Rename each hit to `PlaySubmission`.

In `mobile/src/features/quizzes/QuizPlayScreen.tsx`:
- **`:35` and `:70`:** the query now resolves to `PlayBoard`, so replace `board.data?.board` with `board.data`. Adjust the variable names to match.
- **`:45`:** `fetchPlay(code, user ? null : storedId ?? null)`.
- **`:79`:** `submitPlay(code, body)`.
- If `user` is now unused there, remove its binding.

- [ ] **Step 3: Backend**

1. **`quizzes/service.ts:66-73`.** Replace the `PlayBoard` interface with:
   ```ts
   export type { PlayBoard } from "@scripta/shared";
   ```
   and import it for local use.

2. **`quizzes/wire.ts:16`.** Change `quizToWorks(quiz: Quiz, known?: Map<string, string>): Quiz` to return the shared quiz type:
   ```ts
   import type { Quiz as WireQuiz, QuizData } from "@scripta/shared";
   export function quizToWorks(quiz: Quiz, known?: Map<string, string>): WireQuiz {
   ```
   Its `data` stays `{ ...data, books, questions }`, cast once `as QuizData`. That cast is where stored JSON becomes the wire shape. Find the callers that typed the result as the backend `Quiz` with:
   ```bash
   rg -n "quizToWorks" backend/src
   ```
   They keep compiling, because they send the result.

3. **`quizzes/routes.ts:244`.** Change the play answer to:
   ```ts
   return reply.send({ playId: outcome.playId, score: outcome.score, correct: outcome.correct } satisfies PlayResponse);
   ```
   and import `type PlayResponse` from `@scripta/shared`.

- [ ] **Step 4: Run all checks**

```bash
npm run typecheck --workspace backend
npm test --workspace backend
npm test --workspace frontend
npm run lint --workspace frontend
npm run typecheck --workspace frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile
```
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src mobile/src backend/src
git commit -m "Serve quizzes from the shared factory and check their wire answers"
```

### Task 14: Phase 3 gate

- [ ] **Step 1:** Run the full CI sequence from Task 7, Step 1. Expected: exit 0.
- [ ] **Step 2:** Run the `security-review` skill.
- [ ] **Step 3:** Use the `ship` skill. Push `claude/shared-feature-apis-3-quizzes`, open PR 3 with base `claude/shared-feature-apis-2-tierlists`, title it "Shared feature APIs 3/5: quizzes", and turn auto-merge on.

---

## Phase 4 — public and community (PR 4, branch `claude/shared-feature-apis-4-community`, stacked on PR 3)

```bash
git switch -c claude/shared-feature-apis-4-community
```

### Task 15: Shared public payloads, `CommunityProfileView`, `createPublicApi` and `createCommunityApi`

**Files:**
- Modify: `packages/shared/src/public/types.ts`
- Create: `packages/shared/src/public/api.ts`
- Modify: `packages/shared/src/public/index.ts`
- Modify: `packages/shared/src/community/types.ts`
- Create: `packages/shared/src/community/api.ts`
- Modify: `packages/shared/src/community/index.ts`
- Test: `packages/shared/src/public/api.test.ts`
- Test: `packages/shared/src/community/api.test.ts`

**Interfaces:**
- Produces:
  - Types `PublicMural`, `PublicLibraryData`, `MuralPublicPayload`, `SharedMuralPayload` and `SharedLibraryPayload`, from the package root.
  - `CommunityProfileView`, from `@scripta/shared/community`.
  - `createPublicApi(request)`, returning:
    - `fetchSharedMural(token): Promise<SharedMuralPayload>`
    - `fetchSharedLibrary(token): Promise<SharedLibraryPayload>`
  - `createCommunityApi(request)`, from `@scripta/shared/community`, returning:
    - `fetchDashboard(cursor?: string): Promise<DashboardFeedPage>`
    - `markDashboardSeen(): Promise<void>`
    - `fetchDiscover(type: DiscoverType, q: string, offset?: number): Promise<{ items: DiscoverItem[]; nextOffset: number | null }>`
    - `searchPeople(q): Promise<PersonResult[]>`
    - `fetchSuggestedPeople(): Promise<SuggestedReader[]>`
    - `fetchProfile(username): Promise<CommunityProfileView>`
    - `fetchActivity(username, cursor?: string): Promise<Page<ActivityItem>>`
    - `fetchProfileLibrary(username): Promise<{ data: LibraryData | null }>`
    - `updateFeedSettings(settings: FeedSettings): Promise<void>`
    - `followUser(userId): Promise<void>`
    - `unfollowUser(userId): Promise<void>`
    - `publishProfile(input: PublishProfileInput): Promise<void>`
    - `unpublishProfile(): Promise<void>`
    - `fetchOwnProfile(): Promise<OwnProfile>`
    - `setShelfMural(muralId): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/public/api.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createPublicApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createPublicApi(request) };
}

test("fetchSharedMural is anonymous and encodes the token", async () => {
  const { calls, api } = recorder();
  await api.fetchSharedMural("a/b c");
  assert.deepEqual(calls, [{ path: "/murals/shared/a%2Fb%20c", init: { auth: "none" } }]);
});

test("fetchSharedLibrary is anonymous and encodes the token", async () => {
  const { calls, api } = recorder();
  await api.fetchSharedLibrary("t?1");
  assert.deepEqual(calls, [{ path: "/library/shared/t%3F1", init: { auth: "none" } }]);
});
```

`packages/shared/src/community/api.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createCommunityApi, type CommunityApi } from "./api.js";
import type { FeedSettings, PublishProfileInput } from "./types.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createCommunityApi(request) };
}

const settings = {} as FeedSettings;
const input = {} as PublishProfileInput;

const cases: Array<[string, (api: CommunityApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchDashboard", (api) => api.fetchDashboard(), "/community/dashboard", { auth: "required" }],
  ["markDashboardSeen", (api) => api.markDashboardSeen(), "/community/dashboard/seen", { method: "POST", auth: "required" }],
  ["fetchDiscover", (api) => api.fetchDiscover("tierlist" as never, "q", 20), "/community/discover?type=tierlist&q=q&offset=20", { auth: "optional" }],
  ["searchPeople", (api) => api.searchPeople("a b"), "/community/people?q=a%20b", { auth: "required" }],
  ["fetchSuggestedPeople", (api) => api.fetchSuggestedPeople(), "/community/people/suggested", { auth: "required" }],
  ["fetchProfile", (api) => api.fetchProfile("zoë"), "/community/profiles/zo%C3%AB", { auth: "optional" }],
  ["fetchActivity", (api) => api.fetchActivity("u", "c 1"), "/community/profiles/u/activity?cursor=c%201", { auth: "optional" }],
  ["fetchActivity without cursor", (api) => api.fetchActivity("u"), "/community/profiles/u/activity", { auth: "optional" }],
  ["fetchProfileLibrary", (api) => api.fetchProfileLibrary("u"), "/community/profiles/u/library", { auth: "none" }],
  ["updateFeedSettings", (api) => api.updateFeedSettings(settings), "/community/profile/feed-settings", { method: "PUT", body: settings, auth: "required" }],
  ["followUser", (api) => api.followUser("u1"), "/community/follows", { method: "POST", body: { userId: "u1" }, auth: "required" }],
  ["unfollowUser", (api) => api.unfollowUser("u/1"), "/community/follows/u%2F1", { method: "DELETE", auth: "required" }],
  ["publishProfile", (api) => api.publishProfile(input), "/community/profile/publish", { method: "PUT", body: input, auth: "required" }],
  ["unpublishProfile", (api) => api.unpublishProfile(), "/community/profile/publish", { method: "DELETE", auth: "required" }],
  ["fetchOwnProfile", (api) => api.fetchOwnProfile(), "/community/profile", { auth: "required" }],
  ["setShelfMural", (api) => api.setShelfMural("m1"), "/community/profile/mural", { method: "PUT", body: { muralId: "m1" }, auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder({ items: [], people: [] });
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("people lists are unwrapped", async () => {
  assert.deepEqual(await recorder({ people: ["P"] }).api.searchPeople("a"), ["P"]);
  assert.deepEqual(await recorder({ people: ["S"] }).api.fetchSuggestedPeople(), ["S"]);
});

test("void endpoints resolve undefined", async () => {
  const { api } = recorder({});
  assert.equal(await api.followUser("u1"), undefined);
  assert.equal(await api.markDashboardSeen(), undefined);
});
```

Before running, check how `dashboardQuery(undefined)` renders:
```bash
rg -n "export function dashboardQuery" -A4 packages/shared/src/dashboard.ts
```
If it returns a non-empty string for no cursor, change the `fetchDashboard` case's expected path to `"/community/dashboard" + dashboardQuery()`, imported from `../dashboard.js`.

Then check how `fetchDashboard` treats an answer with no items: it calls `withKnownDigestItems`, so the recorder answers `{ items: [] }`. If `withKnownDigestItems` needs more fields, give the recorder a minimal valid `DashboardFeedPage` for that case.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, cannot find `./api.js` in `public` and `community`.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/public/types.ts`:
```ts
import type { PublicReaderCard } from "../library/readerIdentity.js";
import type { ShelfTheme } from "../library/bookGenres.js";
import type { LibraryData } from "../library/index.js";
import type { MuralBlock, ReaderProfile } from "../murals/murals.js";
import type { ThemeId } from "../themes/index.js";
import type { ResolvedTierlist } from "../tierlists/types.js";

export interface PublicMural {
  id: string;
  name: string;
  theme: ThemeId;
  blocks: MuralBlock[];
  coverImageUrl: string | null;
}

export interface PublicLibraryData {
  collectionBooks?: Record<string, string[]>;
  books: PublicBookData[];
  highlights: PublicHighlight[];
  currentlyReading: PublicBookData[];
  stats: Record<string, number>;
  shelfTheme?: ShelfTheme;
  readerCard?: PublicReaderCard;
}

export interface MuralPublicPayload {
  mural: PublicMural;
  library: PublicLibraryData;
  profile?: ReaderProfile;
  imageUrls: Record<string, string | null>;
  tierlists: Record<string, ResolvedTierlist>;
}

export interface SharedMuralPayload extends Omit<PublicLibraryData, "collectionBooks"> {
  mural: PublicMural;
  profile?: ReaderProfile;
  imageUrls: Record<string, string | null>;
  tierlists: Record<string, ResolvedTierlist>;
}

export interface SharedLibraryPayload {
  data: LibraryData;
}
```
Move these imports to the top of the file. Each import path must point at the file that actually declares the type. Check with:
```bash
rg -n "export (interface|type) (ThemeId|LibraryData)\b" packages/shared/src
```

`packages/shared/src/public/api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { SharedLibraryPayload, SharedMuralPayload } from "./types.js";

export function createPublicApi(request: ApiRequest) {
  return {
    fetchSharedMural(token: string): Promise<SharedMuralPayload> {
      return request<SharedMuralPayload>(apiPath`/murals/shared/${token}`, { auth: "none" });
    },
    fetchSharedLibrary(token: string): Promise<SharedLibraryPayload> {
      return request<SharedLibraryPayload>(apiPath`/library/shared/${token}`, { auth: "none" });
    },
  };
}
```
Add `export * from "./api.js";` to `packages/shared/src/public/index.ts`.

Append to `packages/shared/src/community/types.ts`:
```ts
export interface CommunityProfileView {
  private: boolean;
  profile: PublishedProfile;
  mural: MuralPublicPayload | null;
  published: { tierlists: TierlistSummary[]; tournaments: TournamentSummary[] };
  feedSettings?: FeedSettings;
}
```
Import `type MuralPublicPayload` from `../public/types.js`.

`packages/shared/src/community/api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import { dashboardQuery, withKnownDigestItems, type DashboardFeedPage } from "../dashboard.js";
import type { LibraryData } from "../library/index.js";
import type { ActivityItem, CommunityProfileView, DiscoverItem, DiscoverType, FeedSettings, OwnProfile, Page, PersonResult, PublishProfileInput, SuggestedReader } from "./types.js";

export function createCommunityApi(request: ApiRequest) {
  return {
    async fetchDashboard(cursor?: string): Promise<DashboardFeedPage> {
      return withKnownDigestItems(await request<DashboardFeedPage>(`/community/dashboard${dashboardQuery(cursor)}`, { auth: "required" }));
    },
    async markDashboardSeen(): Promise<void> {
      await request("/community/dashboard/seen", { method: "POST", auth: "required" });
    },
    fetchDiscover(type: DiscoverType, q: string, offset = 0): Promise<{ items: DiscoverItem[]; nextOffset: number | null }> {
      const params = new URLSearchParams({ type, q, offset: String(offset) });
      return request(`/community/discover?${params}`, { auth: "optional" });
    },
    async searchPeople(q: string): Promise<PersonResult[]> {
      return (await request<{ people: PersonResult[] }>(`/community/people?q=${encodeURIComponent(q)}`, { auth: "required" })).people;
    },
    async fetchSuggestedPeople(): Promise<SuggestedReader[]> {
      return (await request<{ people: SuggestedReader[] }>("/community/people/suggested", { auth: "required" })).people;
    },
    fetchProfile(username: string): Promise<CommunityProfileView> {
      return request<CommunityProfileView>(apiPath`/community/profiles/${username}`, { auth: "optional" });
    },
    fetchActivity(username: string, cursor?: string): Promise<Page<ActivityItem>> {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      return request<Page<ActivityItem>>(apiPath`/community/profiles/${username}/activity` + query, { auth: "optional" });
    },
    fetchProfileLibrary(username: string): Promise<{ data: LibraryData | null }> {
      return request(apiPath`/community/profiles/${username}/library`, { auth: "none" });
    },
    async updateFeedSettings(settings: FeedSettings): Promise<void> {
      await request("/community/profile/feed-settings", { method: "PUT", body: settings, auth: "required" });
    },
    async followUser(userId: string): Promise<void> {
      await request("/community/follows", { method: "POST", body: { userId }, auth: "required" });
    },
    async unfollowUser(userId: string): Promise<void> {
      await request(apiPath`/community/follows/${userId}`, { method: "DELETE", auth: "required" });
    },
    async publishProfile(input: PublishProfileInput): Promise<void> {
      await request("/community/profile/publish", { method: "PUT", body: input, auth: "required" });
    },
    async unpublishProfile(): Promise<void> {
      await request("/community/profile/publish", { method: "DELETE", auth: "required" });
    },
    fetchOwnProfile(): Promise<OwnProfile> {
      return request<OwnProfile>("/community/profile", { auth: "required" });
    },
    async setShelfMural(muralId: string): Promise<void> {
      await request("/community/profile/mural", { method: "PUT", body: { muralId }, auth: "required" });
    },
  };
}

export type CommunityApi = ReturnType<typeof createCommunityApi>;
```
Add `export * from "./api.js";` to `packages/shared/src/community/index.ts`.

If `URLSearchParams` is rejected by the shared typecheck (lib `ES2022` with no DOM), `librarySaver.ts` already shows how the global types come in. Fall back to:
```ts
`?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}&offset=${offset}`
```
and update the test's expected path to that exact encoding.

- [ ] **Step 4: Run the checks**

```bash
npm test --workspace @scripta/shared
npm run typecheck --workspace @scripta/shared
npm run build --workspace @scripta/shared
```
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "Share the public payloads, community profile and both factories"
```

### Task 16: Web and mobile public and community over the factories

**Files:**
- Modify: `frontend/src/api/sharedMurals.ts` (full rewrite)
- Modify: `frontend/src/api/sharedLibrary.ts` (full rewrite)
- Modify: `frontend/src/api/community.ts` (full rewrite)
- Modify: `mobile/src/features/public/api.ts` (full rewrite)
- Modify: `mobile/src/features/community/api.ts` (full rewrite)
- Modify: `mobile/src/features/community/DiscoverPane.tsx:29`
- Modify: mobile callers of `searchPeople` and `fetchSuggestedPeople`

**Interfaces:**
- Consumes: `createPublicApi`, `createCommunityApi` and the types (Task 15).
- Produces:
  - **Web:** today's names (`fetchPeople`, `fetchCommunityProfile`).
  - **Mobile:** today's names. `searchPeople` and `fetchSuggestedPeople` now resolve the list.

- [ ] **Step 1: Rewrite the web modules**

`frontend/src/api/sharedMurals.ts`:
```ts
import { createPublicApi } from "@scripta/shared";
import { request } from "./request";

export type { PublicBookData, PublicHighlight, SharedMuralPayload } from "@scripta/shared";

export const { fetchSharedMural } = createPublicApi(request);
```

`frontend/src/api/sharedLibrary.ts`:
```ts
import { createPublicApi } from "@scripta/shared";
import { request } from "./request";

export type { SharedLibraryPayload } from "@scripta/shared";

export const { fetchSharedLibrary } = createPublicApi(request);
```

`frontend/src/api/community.ts`:
```ts
import { createCommunityApi } from "@scripta/shared/community";
import { request } from "./request";

export type { CommunityProfileView } from "@scripta/shared/community";

export const {
  fetchDashboard,
  markDashboardSeen,
  fetchDiscover,
  searchPeople: fetchPeople,
  fetchSuggestedPeople,
  fetchProfile: fetchCommunityProfile,
  fetchActivity,
  fetchProfileLibrary,
  updateFeedSettings,
  followUser,
  unfollowUser,
  publishProfile,
  unpublishProfile,
  fetchOwnProfile,
  setShelfMural,
} = createCommunityApi(request);
```

- [ ] **Step 2: Rewrite the mobile modules**

`mobile/src/features/public/api.ts`:
```ts
import { createPublicApi } from "@scripta/shared";
import { request } from "../../core/api";

export type { PublicBookData, PublicHighlight, SharedMuralPayload } from "@scripta/shared";

export const { fetchSharedLibrary, fetchSharedMural } = createPublicApi(request);
```

`mobile/src/features/community/api.ts`:
```ts
import type { Page } from "@scripta/shared/community";
import { createCommunityApi } from "@scripta/shared/community";
import { request } from "../../core/api";

export type { CommunityProfileView } from "@scripta/shared/community";

export type CommunityPage<T> = Page<T>;

export const {
  fetchDashboard,
  markDashboardSeen,
  fetchDiscover,
  searchPeople,
  fetchSuggestedPeople,
  fetchProfile,
  fetchActivity,
  fetchProfileLibrary,
  updateFeedSettings,
  followUser,
  unfollowUser,
  publishProfile,
  unpublishProfile,
  fetchOwnProfile,
  setShelfMural,
} = createCommunityApi(request);
```

In `mobile/src/features/community/DiscoverPane.tsx:29`, drop the last argument:
```ts
fetchDiscover(filter, needle, pageParam)
```
If `user` is now unused there, remove its binding.

Find the people-list callers:
```bash
rg -n "searchPeople\(|fetchSuggestedPeople\(" mobile/src
```
Each caller that read `.people` off the result now gets the array directly. Remove the `.people` access.

- [ ] **Step 3: Typecheck and fix the remaining call sites**

```bash
npm run typecheck --workspace frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile
```
Expected errors and how to fix them:
- **`profile`:** code that built or read `CommunityProfileView.mural` now has `profile?`. That's additive, so it should not error.
- **`collectionBooks`:** code that spread `library` into a shared-mural shape may now see `collectionBooks`. That field is optional, so it should not error either.
- **Anything else:** fix it at the call site.

- [ ] **Step 4: Run the full client checks**

```bash
npm test --workspace frontend
npm run lint --workspace frontend
npm run typecheck --workspace frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile
```
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src mobile/src
git commit -m "Serve share links and community on both clients from the shared factories

Share tokens are now URL-encoded on web too, and mobile profile,
activity and discover send the token only when one is held."
```

### Task 17: Backend public and community adopt the shared types

**Files:**
- Modify: `backend/src/modules/murals/domain/publicPayload.ts:9-17` (`MuralPublicPayload`, `PublicLibraryData`)
- Modify: `backend/src/modules/murals/routes.ts:308-320` (shared-mural answer)
- Modify: `backend/src/modules/library/publicResolver.ts:26` (`ResolvedPublicData`)
- Modify: `backend/src/modules/community/service.ts:75-81` (`PublicProfileView`)

**Interfaces:**
- Consumes: `MuralPublicPayload`, `PublicLibraryData`, `SharedMuralPayload` and `MuralBlock` from `@scripta/shared`, and `CommunityProfileView` from `@scripta/shared/community`.
- Produces: backend `MuralPublicPayload` and `PublicProfileView` are now the shared types.

- [ ] **Step 1: Replace the identical copies**

1. **`publicResolver.ts:26`.** Replace `ResolvedPublicData` with:
   ```ts
   import type { PublicLibraryData } from "@scripta/shared";
   export type ResolvedPublicData = PublicLibraryData;
   ```
   Then rename the uses, so the alias line can go:
   ```bash
   rg -n "ResolvedPublicData" backend/src
   ```
   Rename each to `PublicLibraryData`, and delete the alias once there are no hits.

2. **`murals/domain/publicPayload.ts`.**
   - Delete the local `PublicLibraryData` alias and `MuralPublicPayload` interface.
   - Import both from `@scripta/shared`, and re-export `MuralPublicPayload` for its existing importers.
   - In `resolveMuralPublicPayload`, the stored `blocks: unknown` becomes the wire `MuralBlock[]` at exactly one point, where the payload's `mural` object is built:
     ```ts
     blocks: (Array.isArray(blocks) ? blocks : []) as MuralBlock[],
     ```
     Keep whatever the function does today for non-arrays; check the current line before replacing it.
   - `profile` stays `resolvePublicReaderProfile(...)`, which returns `ReaderProfile | undefined`. That is assignable to `profile?: ReaderProfile`.

3. **`community/service.ts:75-81`.** Replace `PublicProfileView` with:
   ```ts
   import type { CommunityProfileView } from "@scripta/shared/community";
   ```
   and rename its uses:
   ```bash
   rg -n "PublicProfileView" backend/src
   ```

- [ ] **Step 2: Annotate the shared-mural answer**

In `backend/src/modules/murals/routes.ts:308-320`, apply `satisfies SharedMuralPayload` to the sent object, and import `type SharedMuralPayload` from `@scripta/shared`.

The library share route (`/library/shared/:token`) sends the stored document as `{ data: unknown }`. Leave it unannotated. The spec adds no runtime validation, and that `data` has no canonicalising function to annotate.

- [ ] **Step 3: Run the backend checks**

```bash
npm run typecheck --workspace backend
npm test --workspace backend
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add backend/src
git commit -m "Check the share-link and community profile answers against the shared types"
```

### Task 18: Phase 4 gate and device pass

- [ ] **Step 1:** Run the full CI sequence from Task 7, Step 1. Expected: exit 0.
- [ ] **Step 2:** Run the `security-review` skill. The community profile, activity and discover routes, and the share-link token encoding, change in this phase.
- [ ] **Step 3:** Use the `ship` skill. Push `claude/shared-feature-apis-4-community`, open PR 4 with base `claude/shared-feature-apis-3-quizzes`, title it "Shared feature APIs 4/5: share links and community", and turn auto-merge **off** for this PR until the device pass reports back.
- [ ] **Step 4: Dispatch `device-checker` for one smoke pass**

Give it this worktree path, a screenshot directory, and these checks:
1. **Arena:** signed in, open an active tournament and vote on a duel. Reopen the tournament: the duel shows as voted.
2. **Tier list:** signed out, open a tier list voting link and submit a ballot. It succeeds.
3. **Quiz:** signed in, play a quiz. The result screen shows the score.
4. **Community:** signed in, open another reader's community profile, and open its activity list. Both load.

If all four pass, turn auto-merge on for PR 4. If any fail, diagnose with the `diagnosing-bugs` skill before touching PRs 1–4.

---

## Phase 5 — socials, gallery, murals, works (PR 5, branch `claude/shared-feature-apis-5-rest`, stacked on PR 4)

```bash
git switch -c claude/shared-feature-apis-5-rest
```

### Task 19: Shared socials, gallery, murals and works factories

**Files:**
- Create: `packages/shared/src/socials/types.ts`
- Create: `packages/shared/src/socials/api.ts`
- Create: `packages/shared/src/socials/index.ts`
- Create: `packages/shared/src/gallery/types.ts`
- Create: `packages/shared/src/gallery/api.ts`
- Create: `packages/shared/src/gallery/index.ts`
- Create: `packages/shared/src/murals/api.ts`
- Modify: `packages/shared/src/murals/index.ts`
- Modify: `packages/shared/src/murals/murals.ts:118-119` (cover fields)
- Create: `packages/shared/src/works/api.ts`
- Modify: `packages/shared/src/works/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/socials/api.test.ts`
- Test: `packages/shared/src/gallery/api.test.ts`
- Test: `packages/shared/src/murals/api.test.ts`
- Test: `packages/shared/src/works/api.test.ts`

**Interfaces:**
- Produces:
  - **Types:**
    - `SocialProvider = "x" | "instagram" | "threads" | "tiktok" | "bluesky"`
    - `SocialStatus`
    - `GalleryImage`
    - `Mural.coverImageId?: string | null` and `Mural.coverImageUrl?: string | null`
  - **`createSocialsApi(request)`:**
    - `fetchSocials(): Promise<SocialStatus[]>`
    - `createLinkSession(provider: Exclude<SocialProvider, "bluesky">): Promise<string>`
    - `connectBluesky(handle, appPassword): Promise<SocialStatus[]>`
    - `disconnectSocial(provider: SocialProvider): Promise<SocialStatus[]>`
    - `postToSocial(provider: "x" | "threads", text): Promise<{ postUrl?: string }>`
  - **`createGalleryApi(request)`:**
    - `fetchGalleryImages(): Promise<GalleryImage[]>`
    - `deleteGalleryImage(id): Promise<void>`
  - **`createMuralsApi(request)`:**
    - `fetchMurals(): Promise<Mural[]>`
    - `fetchMural(id): Promise<Mural>`
    - `createMural(name, theme: ThemeId, folderId?: string | null): Promise<Mural>`
    - `updateMural(id, patch: { name?: string; theme?: ThemeId; blocks?: MuralBlock[]; folderId?: string | null; updatedAt?: string }): Promise<Mural>`
    - `deleteMural(id): Promise<void>`
    - `setMuralCover(id, imageId, url): Promise<Mural>`
    - `clearMuralCover(id): Promise<Mural>`
    - `shareMural(id): Promise<Mural>`
    - `unshareMural(id): Promise<Mural>`
    - `fetchFolders(): Promise<MuralFolder[]>`
    - `createFolder(name, parentId?: string | null): Promise<MuralFolder>`
    - `updateFolder(id, patch: { name?: string; parentId?: string | null }): Promise<MuralFolder>`
    - `deleteFolder(id): Promise<void>`
  - **`createWorksApi(request)`:**
    - `fetchWork(id): Promise<WorkPage>`

- [ ] **Step 1: Write the failing tests**

Each file uses the same `recorder` helper as Task 4, with its own factory.

`packages/shared/src/socials/api.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createSocialsApi, type SocialsApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createSocialsApi(request) };
}

const cases: Array<[string, (api: SocialsApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchSocials", (api) => api.fetchSocials(), "/socials", { auth: "required" }],
  ["createLinkSession", (api) => api.createLinkSession("x"), "/socials/x/link-session", { method: "POST", auth: "required" }],
  ["connectBluesky", (api) => api.connectBluesky("h", "p"), "/socials/bluesky/connect", { method: "POST", body: { handle: "h", appPassword: "p" }, auth: "required" }],
  ["disconnectSocial", (api) => api.disconnectSocial("threads"), "/socials/threads", { method: "DELETE", auth: "required" }],
  ["postToSocial", (api) => api.postToSocial("x", "hi"), "/socials/x/post", { method: "POST", body: { text: "hi" }, auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder({ socials: [], linkId: "L" });
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("envelopes are unwrapped", async () => {
  assert.deepEqual(await recorder({ socials: ["S"] }).api.fetchSocials(), ["S"]);
  assert.equal(await recorder({ linkId: "L" }).api.createLinkSession("x"), "L");
  assert.deepEqual(await recorder({ socials: ["S"] }).api.disconnectSocial("x"), ["S"]);
});
```

`packages/shared/src/gallery/api.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createGalleryApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createGalleryApi(request) };
}

test("fetchGalleryImages unwraps images", async () => {
  const { calls, api } = recorder({ images: ["I"] });
  assert.deepEqual(await api.fetchGalleryImages(), ["I"]);
  assert.deepEqual(calls, [{ path: "/gallery", init: { auth: "required" } }]);
});

test("deleteGalleryImage encodes the id and resolves undefined", async () => {
  const { calls, api } = recorder({});
  assert.equal(await api.deleteGalleryImage("a/b"), undefined);
  assert.deepEqual(calls, [{ path: "/gallery/a%2Fb", init: { method: "DELETE", auth: "required" } }]);
});
```

`packages/shared/src/murals/api.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createMuralsApi, type MuralsApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createMuralsApi(request) };
}

const cases: Array<[string, (api: MuralsApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchMurals", (api) => api.fetchMurals(), "/murals", { auth: "required" }],
  ["fetchMural", (api) => api.fetchMural("m1"), "/murals/m1", { auth: "required" }],
  ["createMural", (api) => api.createMural("N", "paper" as never), "/murals", { method: "POST", body: { name: "N", theme: "paper", folderId: null }, auth: "required" }],
  ["updateMural", (api) => api.updateMural("m1", { name: "M", updatedAt: "u" }), "/murals/m1", { method: "PUT", body: { name: "M", updatedAt: "u" }, auth: "required" }],
  ["deleteMural", (api) => api.deleteMural("m1"), "/murals/m1", { method: "DELETE", auth: "required" }],
  ["setMuralCover", (api) => api.setMuralCover("m1", "i1", "https://x"), "/murals/m1/cover", { method: "PUT", body: { imageId: "i1", url: "https://x" }, auth: "required" }],
  ["clearMuralCover", (api) => api.clearMuralCover("m1"), "/murals/m1/cover", { method: "DELETE", auth: "required" }],
  ["shareMural", (api) => api.shareMural("m1"), "/murals/m1/share", { method: "POST", auth: "required" }],
  ["unshareMural", (api) => api.unshareMural("m1"), "/murals/m1/unshare", { method: "POST", auth: "required" }],
  ["fetchFolders", (api) => api.fetchFolders(), "/murals/folders", { auth: "required" }],
  ["createFolder", (api) => api.createFolder("F"), "/murals/folders", { method: "POST", body: { name: "F", parentId: null }, auth: "required" }],
  ["updateFolder", (api) => api.updateFolder("f1", { parentId: null }), "/murals/folders/f1", { method: "PUT", body: { parentId: null }, auth: "required" }],
  ["deleteFolder", (api) => api.deleteFolder("f1"), "/murals/folders/f1", { method: "DELETE", auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder({ murals: [], folders: [] });
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("lists are unwrapped and deletes resolve undefined", async () => {
  assert.deepEqual(await recorder({ murals: ["M"] }).api.fetchMurals(), ["M"]);
  assert.deepEqual(await recorder({ folders: ["F"] }).api.fetchFolders(), ["F"]);
  assert.equal(await recorder({}).api.deleteMural("m1"), undefined);
  assert.equal(await recorder({}).api.deleteFolder("f1"), undefined);
});
```

`packages/shared/src/works/api.test.ts`:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createWorksApi } from "./api.js";

test("fetchWork is optional-auth and encodes the id", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return { id: "W" };
  }) as ApiRequest;
  assert.deepEqual(await createWorksApi(request).fetchWork("a/b"), { id: "W" });
  assert.deepEqual(calls, [{ path: "/works/a%2Fb", init: { auth: "optional" } }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, cannot find the four `api.js` modules.

- [ ] **Step 3: Implement**

`packages/shared/src/socials/types.ts`:
```ts
export type SocialProvider = "x" | "instagram" | "threads" | "tiktok" | "bluesky";

export interface SocialStatus {
  provider: SocialProvider;
  enabled: boolean;
  connected: boolean;
  handle: string | null;
  connectedAt: string | null;
}
```

`packages/shared/src/socials/api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { SocialProvider, SocialStatus } from "./types.js";

export function createSocialsApi(request: ApiRequest) {
  return {
    async fetchSocials(): Promise<SocialStatus[]> {
      return (await request<{ socials: SocialStatus[] }>("/socials", { auth: "required" })).socials;
    },
    async createLinkSession(provider: Exclude<SocialProvider, "bluesky">): Promise<string> {
      return (await request<{ linkId: string }>(apiPath`/socials/${provider}/link-session`, { method: "POST", auth: "required" })).linkId;
    },
    async connectBluesky(handle: string, appPassword: string): Promise<SocialStatus[]> {
      return (await request<{ socials: SocialStatus[] }>("/socials/bluesky/connect", { method: "POST", body: { handle, appPassword }, auth: "required" })).socials;
    },
    async disconnectSocial(provider: SocialProvider): Promise<SocialStatus[]> {
      return (await request<{ socials: SocialStatus[] }>(apiPath`/socials/${provider}`, { method: "DELETE", auth: "required" })).socials;
    },
    postToSocial(provider: "x" | "threads", text: string): Promise<{ postUrl?: string }> {
      return request(apiPath`/socials/${provider}/post`, { method: "POST", body: { text }, auth: "required" });
    },
  };
}

export type SocialsApi = ReturnType<typeof createSocialsApi>;
```

`packages/shared/src/socials/index.ts`:
```ts
export * from "./types.js";
export * from "./api.js";
```

`packages/shared/src/gallery/types.ts`:
```ts
export interface GalleryImage {
  id: string;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
  url: string;
}
```

`packages/shared/src/gallery/api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { GalleryImage } from "./types.js";

export function createGalleryApi(request: ApiRequest) {
  return {
    async fetchGalleryImages(): Promise<GalleryImage[]> {
      return (await request<{ images: GalleryImage[] }>("/gallery", { auth: "required" })).images;
    },
    async deleteGalleryImage(id: string): Promise<void> {
      await request(apiPath`/gallery/${id}`, { method: "DELETE", auth: "required" });
    },
  };
}
```

`packages/shared/src/gallery/index.ts`:
```ts
export * from "./types.js";
export * from "./api.js";
```

`packages/shared/src/murals/api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { ThemeId } from "../themes/index.js";
import type { MuralFolder } from "./folders.js";
import type { Mural, MuralBlock } from "./murals.js";

export function createMuralsApi(request: ApiRequest) {
  return {
    async fetchMurals(): Promise<Mural[]> {
      return (await request<{ murals: Mural[] }>("/murals", { auth: "required" })).murals;
    },
    fetchMural(id: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}`, { auth: "required" });
    },
    createMural(name: string, theme: ThemeId, folderId: string | null = null): Promise<Mural> {
      return request<Mural>("/murals", { method: "POST", body: { name, theme, folderId }, auth: "required" });
    },
    updateMural(id: string, patch: { name?: string; theme?: ThemeId; blocks?: MuralBlock[]; folderId?: string | null; updatedAt?: string }): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}`, { method: "PUT", body: patch, auth: "required" });
    },
    async deleteMural(id: string): Promise<void> {
      await request(apiPath`/murals/${id}`, { method: "DELETE", auth: "required" });
    },
    setMuralCover(id: string, imageId: string, url: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}/cover`, { method: "PUT", body: { imageId, url }, auth: "required" });
    },
    clearMuralCover(id: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}/cover`, { method: "DELETE", auth: "required" });
    },
    shareMural(id: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}/share`, { method: "POST", auth: "required" });
    },
    unshareMural(id: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}/unshare`, { method: "POST", auth: "required" });
    },
    async fetchFolders(): Promise<MuralFolder[]> {
      return (await request<{ folders: MuralFolder[] }>("/murals/folders", { auth: "required" })).folders;
    },
    createFolder(name: string, parentId: string | null = null): Promise<MuralFolder> {
      return request<MuralFolder>("/murals/folders", { method: "POST", body: { name, parentId }, auth: "required" });
    },
    updateFolder(id: string, patch: { name?: string; parentId?: string | null }): Promise<MuralFolder> {
      return request<MuralFolder>(apiPath`/murals/folders/${id}`, { method: "PUT", body: patch, auth: "required" });
    },
    async deleteFolder(id: string): Promise<void> {
      await request(apiPath`/murals/folders/${id}`, { method: "DELETE", auth: "required" });
    },
  };
}

export type MuralsApi = ReturnType<typeof createMuralsApi>;
```
Check where `MuralFolder` and `ThemeId` are declared, and fix the two import paths if they differ:
```bash
rg -n "export (interface|type) (MuralFolder|ThemeId)\b" packages/shared/src
```
Add `export * from "./api.js";` to `packages/shared/src/murals/index.ts`.

`packages/shared/src/works/api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { WorkPage } from "./types.js";

export function createWorksApi(request: ApiRequest) {
  return {
    fetchWork(id: string): Promise<WorkPage> {
      return request<WorkPage>(apiPath`/works/${id}`, { auth: "optional" });
    },
  };
}
```
Add `export * from "./api.js";` to `packages/shared/src/works/index.ts`.

In `packages/shared/src/murals/murals.ts:118-119`:
```ts
  coverImageId?: string | null;
  coverImageUrl?: string | null;
```

In `packages/shared/src/index.ts`, add:
```ts
export * from "./socials/index.js";
export * from "./gallery/index.js";
```

- [ ] **Step 4: Run the checks**

```bash
npm test --workspace @scripta/shared
npm run typecheck --workspace @scripta/shared
npm run build --workspace @scripta/shared
```
Expected: PASS and exit 0. If the `coverImage*` change breaks a shared function's typing (`murals.ts:134`, `:436-442`), fix it in that function without changing its behaviour.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "Share the socials, gallery, mural and work endpoints"
```

### Task 20: Clients and backend for socials, gallery, murals and works

**Files:**
- Modify: `frontend/src/api/socials.ts` (full rewrite)
- Modify: `frontend/src/api/gallery.ts` (full rewrite)
- Modify: `frontend/src/api/murals.ts` (full rewrite)
- Modify: `frontend/src/api/works.ts` (full rewrite)
- Modify: `mobile/src/features/socials/api.ts` (full rewrite)
- Modify: `mobile/src/features/gallery/api.ts` (full rewrite)
- Modify: `mobile/src/features/murals/api.ts` (full rewrite)
- Modify: `mobile/src/features/works/api.ts` (full rewrite)
- Modify: `mobile/src/features/works/WorkScreen.tsx:27`
- Modify: `backend/src/modules/socials/domain/types.ts:11,33`
- Modify: `backend/src/modules/gallery/domain/types.ts:26`
- Modify: `backend/src/modules/murals/service.ts:12` (`toMural`)
- Modify: `backend/src/modules/murals/domain/types.ts:31-56` (`Mural`, `MuralFolder`)

**Interfaces:**
- Consumes: the four factories and their types (Task 19).
- Produces: today's exported names from every client module. Mobile `fetchWork` drops its `signedIn` argument.

- [ ] **Step 1: Rewrite the web modules**

`frontend/src/api/socials.ts`:
```ts
import { createSocialsApi, type SocialProvider } from "@scripta/shared";
import { API_URL } from "./baseUrl";
import { ApiError } from "./client";
import { request } from "./request";

export type { SocialProvider, SocialStatus } from "@scripta/shared";

const socials = createSocialsApi(request);

export const { fetchSocials, connectBluesky, disconnectSocial, postToSocial } = socials;

export async function startSocialConnect(provider: Exclude<SocialProvider, "bluesky">): Promise<void> {
  const linkId = await socials.createLinkSession(provider);
  window.location.href = `${API_URL}/socials/${provider}/connect?linkId=${encodeURIComponent(linkId)}`;
}

export { ApiError };
```

`frontend/src/api/gallery.ts`:
```ts
import { createGalleryApi, type GalleryImage } from "@scripta/shared";
import { apiFetch } from "./client";
import { request } from "./request";

export type { GalleryImage } from "@scripta/shared";

export const { fetchGalleryImages, deleteGalleryImage } = createGalleryApi(request);

export async function uploadGalleryImage(file: File): Promise<GalleryImage> {
  const form = new FormData();
  form.append("image", file, file.name);
  const body = (await apiFetch("/gallery", { method: "POST", body: form })) as { image: GalleryImage };
  return body.image;
}
```

`frontend/src/api/murals.ts`:
```ts
import { createMuralsApi } from "@scripta/shared";
import { request } from "./request";

export const {
  fetchMurals,
  fetchMural,
  createMural: createMuralApi,
  updateMural: updateMuralApi,
  deleteMural: deleteMuralApi,
  setMuralCover: setMuralCoverApi,
  clearMuralCover: clearMuralCoverApi,
  shareMural: shareMuralApi,
  unshareMural: unshareMuralApi,
  fetchFolders: fetchMuralFolders,
  createFolder: createMuralFolderApi,
  updateFolder: updateMuralFolderApi,
  deleteFolder: deleteMuralFolderApi,
} = createMuralsApi(request);
```

`frontend/src/api/works.ts`:
```ts
import { createWorksApi } from "@scripta/shared";
import { request } from "./request";

export const { fetchWork } = createWorksApi(request);
```

- [ ] **Step 2: Rewrite the mobile modules**

`mobile/src/features/socials/api.ts`:
```ts
import { createSocialsApi, type SocialProvider } from "@scripta/shared";
import { Linking, Share } from "react-native";
import { request } from "../../core/api";
import { API_URL } from "../../core/config";

export type { SocialProvider, SocialStatus } from "@scripta/shared";

const socials = createSocialsApi(request);

export const { fetchSocials, connectBluesky, disconnectSocial, postToSocial } = socials;

export async function startSocialConnect(provider: Exclude<SocialProvider, "bluesky">): Promise<void> {
  const linkId = await socials.createLinkSession(provider);
  await Linking.openURL(`${API_URL}/socials/${provider}/connect?linkId=${encodeURIComponent(linkId)}`);
}

export async function shareNatively(message: string, title?: string): Promise<void> {
  await Share.share({ message, title });
}
```

`mobile/src/features/gallery/api.ts`:
```ts
import { createGalleryApi, type GalleryImage } from "@scripta/shared";
import { File } from "expo-file-system";
import { apiClient, request } from "../../core/api";

export type { GalleryImage } from "@scripta/shared";

export const { fetchGalleryImages, deleteGalleryImage } = createGalleryApi(request);

export async function uploadGalleryImage(file: { uri: string; name: string; mimeType: string }): Promise<GalleryImage> {
  const form = new FormData();
  form.append("image", new File(file.uri));
  return (await apiClient.request<{ image: GalleryImage }>("/gallery", { method: "POST", body: form, auth: true })).image;
}
```

`mobile/src/features/murals/api.ts`:
```ts
import { createMuralsApi } from "@scripta/shared";
import { request } from "../../core/api";

export const {
  fetchMurals,
  fetchMural,
  createMural,
  updateMural,
  deleteMural,
  setMuralCover,
  clearMuralCover,
  shareMural,
  unshareMural,
  fetchFolders,
  createFolder,
  updateFolder,
  deleteFolder,
} = createMuralsApi(request);
```

`mobile/src/features/works/api.ts`:
```ts
import { createWorksApi } from "@scripta/shared";
import { request } from "../../core/api";

export const { fetchWork } = createWorksApi(request);
```

In `mobile/src/features/works/WorkScreen.tsx:27`, use `fetchWork(id)`. If `user` is now unused there, remove its binding.

- [ ] **Step 3: Backend**

1. **`socials/domain/types.ts`.** Replace the `SocialProvider` (`:11`) and `SocialStatus` (`:33`) declarations with:
   ```ts
   export type { SocialProvider, SocialStatus } from "@scripta/shared";
   ```
   Import them for local use if the file references them.

2. **`gallery/domain/types.ts:26`.** Replace the `GalleryImage` interface with:
   ```ts
   export type { GalleryImage } from "@scripta/shared";
   ```

3. **`murals/domain/types.ts`.**
   - Replace `MuralFolder` (`:54`) with a re-export of shared `MuralFolder`. It is identical.
   - Keep the domain `Mural`, which has `blocks: unknown[]`.
   - In `murals/service.ts:12`, change `toMural` to return the shared type:
     ```ts
     import type { Mural as WireMural, MuralBlock } from "@scripta/shared";
     ```
     The function returns `WireMural`. Its `blocks` field keeps the value it builds today, with a cast added once at the end: `as MuralBlock[]`.
   - Change the service methods that returned the domain `Mural` to return `WireMural`. If the domain `Mural` then has no users left, delete it. Check with:
     ```bash
     rg -n "\bMural\b" backend/src/modules/murals
     ```

- [ ] **Step 4: Run all checks**

```bash
npm run typecheck --workspace backend
npm test --workspace backend
npm test --workspace frontend
npm run lint --workspace frontend
npm run typecheck --workspace frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile
```
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src mobile/src backend/src
git commit -m "Serve socials, gallery, murals and works from the shared factories"
```

### Task 21: Phase 5 gate and branch review

- [ ] **Step 1:** Run the full CI sequence from Task 7, Step 1. Expected: exit 0.

- [ ] **Step 2: Check that no client API module calls a request client directly for a factory endpoint**

```bash
rg -n "apiFetch|publicFetch" frontend/src/api --glob '!client.ts' --glob '!request.ts'
rg -n "apiClient\.request" mobile/src/features
```
Expected hits are limited to:
- uploads (`uploadGalleryImage`, `renderTierlistShareVideo`)
- mobile arena `resolveCover`
- modules this plan leaves alone: library, covers, book search, appearance, auth, waitlist and books admin

Any other hit is an endpoint that was missed.

- [ ] **Step 3: Dispatch `branch-reviewer`** with this worktree path and the spec. Fix what it confirms.

- [ ] **Step 4:** Use the `ship` skill. Push `claude/shared-feature-apis-5-rest`, open PR 5 with base `claude/shared-feature-apis-4-community`, title it "Shared feature APIs 5/5: socials, gallery, murals, works", and turn auto-merge on.

- [ ] **Step 5: Tell the user** the stack is open. Note that `todo/architecture-review.md` in the main checkout needs #3 ticked once PR 5 merges.
