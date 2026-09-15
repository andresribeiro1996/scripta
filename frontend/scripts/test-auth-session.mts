import assert from "node:assert/strict";
import { test } from "node:test";
import { authFieldErrors, safeAuthReturnTo } from "@scripta/shared";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const local = new MemoryStorage();
const temporary = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: temporary, configurable: true });
const legacy = { user: { id: "reader", email: "reader@example.com", username: "reader", avatarId: null }, accessToken: "access", refreshToken: "refresh" };
local.setItem("kobo_session", JSON.stringify(legacy));
const store = await import("../src/auth/tokenStore.ts");

test("existing sessions survive migration; remember preference survives refresh and profile changes", () => {
  assert.deepEqual(store.getSession(), legacy);
  store.setSession({ ...legacy, accessToken: "rotated" });
  assert.ok(local.getItem("kobo_session"));
  assert.equal(temporary.getItem("kobo_session"), null);
  store.setSession(legacy, false);
  assert.equal(local.getItem("kobo_session"), null);
  assert.ok(temporary.getItem("kobo_session"));
  store.setSession({ ...legacy, accessToken: "new-token", user: { ...legacy.user, username: "updated" } });
  assert.equal(local.getItem("kobo_session"), null);
  assert.equal(JSON.parse(temporary.getItem("kobo_session")!).user.username, "updated");
  store.setSession(legacy, true);
  assert.equal(temporary.getItem("kobo_session"), null);
  store.setSession(null);
  assert.equal(local.getItem("kobo_session"), null);
  assert.equal(temporary.getItem("kobo_session"), null);
  assert.equal(store.getSession(), null);
});

test("validation supports username login and passphrases without trimming passwords", () => {
  assert.deepEqual(authFieldErrors("login", "reader", "", "x"), {});
  assert.deepEqual(authFieldErrors("signup", " reader@example.com ", "reader", "long passphrase"), {});
  assert.ok(authFieldErrors("signup", "bad", "?", "short").identifier);
  assert.ok(authFieldErrors("signup", "reader@example.com", "?", "short").username);
  assert.ok(authFieldErrors("signup", "reader@example.com", "reader", "x".repeat(129)).password);
});

test("destinations preserve queries and hashes but reject external URLs and auth loops", () => {
  assert.equal(safeAuthReturnTo("/dashboard/library?q=book#result", "/dashboard"), "/dashboard/library?q=book#result");
  for (const value of ["//evil.test", "/\\evil.test", "https://evil.test", "/login?returnTo=/login", "/oauth-success", "/\n/evil", null]) {
    assert.equal(safeAuthReturnTo(value, "/dashboard"), "/dashboard");
  }
});

test("web signup and Google destinations survive account-tree remounts", async () => {
  const flow = await import("../src/auth/returnTo.ts");
  flow.startAuthNavigation("/vote/books?edition=2#ballot", false);
  assert.equal(flow.afterSignIn("reader"), "/vote/books?edition=2#ballot");
  assert.equal(flow.afterSignIn(null), "/choose-username");
  flow.startAuthNavigation(flow.getAuthReturnTo(), true);
  assert.equal(flow.afterSignIn("reader"), "/welcome-avatar");
  assert.equal(flow.takeAuthReturnTo(), "/vote/books?edition=2#ballot");
  assert.equal(flow.afterSignIn("reader"), "/dashboard");
});
