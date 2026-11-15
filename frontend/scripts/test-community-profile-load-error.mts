import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }), configurable: true });

registerHooks({
  resolve: (specifier, context, next) => (specifier.endsWith(".css") ? { url: "data:text/javascript,", format: "module", shortCircuit: true } : next(specifier, context))
});

const { AuthProvider } = await import("../src/auth/AuthContext");
const { setSession } = await import("../src/auth/tokenStore");
const { ApiError } = await import("../src/api/client");
const { CommunityProfilePage } = await import("../src/pages/CommunityProfilePage");

setSession({ user: { id: "u1", email: "a@b.c", username: "alice", avatarId: null }, accessToken: "a", refreshToken: "r" }, false);

const key = ["community", "profile", "bob"];
const failed = (error: unknown) => ({ status: "error", error, fetchStatus: "idle" }) as const;

function render(client: QueryClient) {
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AuthProvider, null, createElement(MemoryRouter, { initialEntries: ["/community/bob"] }, createElement(Routes, null, createElement(Route, { path: "/community/:username", element: createElement(CommunityProfilePage) }))))
    )
  );
}

function clientWith(error: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  client.getQueryCache().build(client, { queryKey: key }).setState(failed(error));
  return client;
}

test("a non-404 profile load failure shows the retry state, not the skeleton", () => {
  const html = render(clientWith(new Error("boom")));
  assert.ok(html.includes("load this profile"));
  assert.ok(html.includes("Retry"));
  assert.ok(!html.includes("Loading profile"));
});

test("a 404 still shows the private state, not the retry state", () => {
  const html = render(clientWith(new ApiError(404, "not found")));
  assert.ok(!html.includes("load this profile"));
});
