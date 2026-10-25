import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes, useOutletContext } from "react-router-dom";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), configurable: true });

const { AuthProvider } = await import("../src/auth/AuthContext");
const { RequireAuth } = await import("../src/auth/RequireAuth");
const { RequireUsername } = await import("../src/auth/RequireUsername");
const { setSession } = await import("../src/auth/tokenStore");

function Child() {
  const { marker } = useOutletContext<{ marker: string }>();
  return createElement("p", null, marker);
}

function Layout() {
  return createElement(Outlet, { context: { marker: "from-layout" } });
}

test("guards forward the layout's outlet context to the page", () => {
  setSession({ user: { id: "u1", email: "a@b.c", username: "alice", avatarId: null }, accessToken: "a", refreshToken: "r" }, false);
  const tree = createElement(
    MemoryRouter,
    { initialEntries: ["/page"] },
    createElement(
      AuthProvider,
      null,
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { element: createElement(Layout) },
          createElement(
            Route,
            { element: createElement(RequireAuth) },
            createElement(Route, { element: createElement(RequireUsername) }, createElement(Route, { path: "/page", element: createElement(Child) }))
          )
        )
      )
    )
  );
  assert.match(renderToString(tree), /from-layout/);
});
