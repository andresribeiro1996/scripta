/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient } from "./apiClient.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("logout during refresh revokes the newest token and leaves no local session", async () => {
  let accessToken: string | null = "access-old";
  let refreshToken: string | null = "refresh-old";
  const refreshResponse = deferred<Response>();
  const refreshStarted = deferred<void>();
  const revokedTokens: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(init?.body?.toString() ?? "{}");
    if (body.refreshToken === "refresh-old") {
      refreshStarted.resolve();
      return refreshResponse.promise;
    }
    revokedTokens.push(body.refreshToken);
    return new Response(null, { status: 204 });
  };
  const tokenStore = {
    async getRefreshToken() {
      return refreshToken;
    },
    async setRefreshToken(token: string) {
      refreshToken = token;
    },
    async clearRefreshToken() {
      refreshToken = null;
    },
  };
  const session = createApiClient(
    "http://api.test",
    tokenStore,
    () => accessToken,
    (token) => {
      accessToken = token;
    },
    fetcher,
  );

  const refreshing = session.refreshAccessToken();
  await refreshStarted.promise;
  const loggingOut = session.logout();
  refreshResponse.resolve(jsonResponse(200, { accessToken: "access-new", refreshToken: "refresh-new" }));

  assert.equal(await refreshing, true);
  await loggingOut;
  assert.deepEqual(revokedTokens, ["refresh-new"]);
  assert.equal(accessToken, null);
  assert.equal(refreshToken, null);
});

test("late old-token 401 responses reuse the completed refresh", async () => {
  let accessToken: string | null = "access-old";
  let refreshToken: string | null = "refresh-old";
  let refreshRequests = 0;
  const lateResponses = [deferred<Response>(), deferred<Response>()];
  let oldTokenRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(input.toString()).pathname;
    if (path === "/auth/refresh") {
      refreshRequests += 1;
      return jsonResponse(200, { accessToken: "access-new", refreshToken: "refresh-new" });
    }
    if (new Headers(init?.headers).get("Authorization") === "Bearer access-old") {
      const requestIndex = oldTokenRequests++;
      return requestIndex === 0 ? jsonResponse(401, { error: "expired" }) : lateResponses[requestIndex - 1]!.promise;
    }
    return jsonResponse(200, { ok: true });
  };
  const tokenStore = {
    async getRefreshToken() {
      return refreshToken;
    },
    async setRefreshToken(token: string) {
      refreshToken = token;
    },
    async clearRefreshToken() {
      refreshToken = null;
    },
  };
  const session = createApiClient(
    "http://api.test",
    tokenStore,
    () => accessToken,
    (token) => {
      accessToken = token;
    },
    fetcher,
  );

  const requests = [1, 2, 3].map(() => session.apiClient.request<{ ok: boolean }>("/resource", { auth: true }));
  await requests[0];
  for (const response of lateResponses) response.resolve(jsonResponse(401, { error: "expired" }));

  assert.deepEqual(await Promise.all(requests), [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(refreshRequests, 1);
});

test("a rejected refresh expires the app session", async () => {
  let accessToken: string | null = "access-old";
  let refreshToken: string | null = "refresh-old";
  let expired = false;
  const session = createApiClient(
    "http://api.test",
    {
      async getRefreshToken() {
        return refreshToken;
      },
      async setRefreshToken(token) {
        refreshToken = token;
      },
      async clearRefreshToken() {
        refreshToken = null;
      },
    },
    () => accessToken,
    (token) => {
      accessToken = token;
    },
    async () => jsonResponse(401, { error: "expired" }),
  );
  session.setSessionExpiredHandler(() => {
    expired = true;
  });

  assert.equal(await session.refreshAccessToken(), false);
  assert.equal(accessToken, null);
  assert.equal(refreshToken, null);
  assert.equal(expired, true);
});

test("multipart bodies are sent unchanged without a JSON content type", async () => {
  const form = new FormData();
  form.append("image", new Blob(["image"]), "cover.jpg");
  let received: RequestInit | undefined;
  const session = createApiClient(
    "http://api.test",
    { async getRefreshToken() { return null; }, async setRefreshToken() {}, async clearRefreshToken() {} },
    () => "access",
    () => {},
    async (_input, init) => {
      received = init;
      return jsonResponse(200, { ok: true });
    },
  );

  await session.apiClient.request("/gallery", { method: "POST", body: form, auth: true });
  assert.equal(received?.body, form);
  assert.equal(new Headers(received?.headers).has("Content-Type"), false);
});

test("non-JSON responses become ApiError messages", async () => {
  const session = createApiClient(
    "http://api.test",
    { async getRefreshToken() { return null; }, async setRefreshToken() {}, async clearRefreshToken() {} },
    () => "access",
    () => {},
    async () => new Response("Bad gateway", { status: 502 }),
  );

  await assert.rejects(session.apiClient.request("/gallery", { auth: true }), /Request failed \(502\)/);
});
