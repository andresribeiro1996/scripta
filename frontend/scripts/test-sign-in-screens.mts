import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });

const { AuthProvider } = await import("../src/auth/AuthContext");
const { LoginPage } = await import("../src/pages/LoginPage");
const { AccountActionPage } = await import("../src/pages/AccountActionPage");
const { CHECKBOX_CLASS } = await import("../src/components/Toolbar");
const { BUTTON_PRIMARY, FIELD_CLASS } = await import("../src/components/page/buttonClasses");

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const page = (path: string, element: ReturnType<typeof createElement>) =>
  renderToString(createElement(MemoryRouter, { initialEntries: [path] }, createElement(AuthProvider, null, element)));
const tag = (html: string, pattern: RegExp) => html.match(new RegExp(`<${pattern.source}\\b(?:=>|[^>])*>`, "s"))?.[0] ?? "";

test("log in sits in a card with visible labels and the shared controls", () => {
  const html = page("/login", createElement(LoginPage));
  assert.match(html, /<div class="sm:rounded-xl sm:border[^"]*sm:p-8">/);
  assert.match(html, /<h1 class="font-display text-3xl[^"]*">Welcome back<\/h1>/);
  assert.match(html, /<label[^>]*for="identifier"[^>]*>Email or username<\/label>/);
  assert.match(html, /<label[^>]*for="password"[^>]*>Password<\/label>/);
  assert.doesNotMatch(html, /placeholder=/);
  assert.ok(tag(html, /input(?=[^>]*id="identifier")/).includes(FIELD_CLASS));
  assert.ok(tag(html, /input(?=[^>]*id="password")/).includes(FIELD_CLASS));
  assert.ok(tag(html, /button(?=[^>]*type="submit")/).includes(BUTTON_PRIMARY));
});

test("Remember me is the shared 44px checkbox in a 44px label", () => {
  const html = page("/login", createElement(LoginPage));
  assert.ok(tag(html, /input(?=[^>]*type="checkbox")/).includes(CHECKBOX_CLASS.replaceAll("'", "&#x27;")));
  assert.match(html, /<label class="flex min-h-11 items-center gap-2[^"]*"><input type="checkbox"/);
});

test("signup labels every field and puts each hint under its own field", () => {
  const html = page("/login?mode=signup", createElement(LoginPage));
  const at = (text: string) => html.indexOf(text);
  assert.match(html, /<label[^>]*for="identifier"[^>]*>Email<\/label>/);
  const order = [at('for="username"'), at('id="username"'), at('id="username-hint"'), at('for="password"'), at('id="password"'), at('id="password-hint"')];
  assert.ok(order.every((n) => n > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("reset and verify without a token centre the message and every link", () => {
  for (const [path, action, message, link] of [
    ["/reset-password", "reset", "This link is missing its reset code.", "Request a new reset link"],
    ["/verify-email", "verify", "This link is missing its verification code.", "Open Settings to resend or correct your email"]
  ] as const) {
    const html = page(path, createElement(AccountActionPage, { action }));
    assert.match(html, new RegExp(`<p role="alert" class="text-center text-sm">${message}</p>`));
    const links = html.slice(html.indexOf('<div class="mt-4 flex flex-col items-center'));
    assert.ok(links.includes(`>${link}</a>`));
    assert.ok(links.includes(">Back to login</a>"));
    assert.doesNotMatch(html, /Request a new email/);
  }
});

test("/oauth-success failure and wait states use the sign-in frame", () => {
  const src = read("src/pages/OAuthSuccessPage.tsx");
  assert.equal(src.match(/<AuthStage>/g)?.length, 2);
  assert.match(src, /<EmptyState[\s\S]*<a href="\/login" className=\{BUTTON_PRIMARY\}>/);
});

test("the Daily Chapter art keeps its size and shrinks in one rule at phone width", () => {
  const css = read("src/components/dailyChapter/dailyChapter.css");
  assert.match(css, /\.daily-chapter-art \{[^}]*flex-shrink: 0;/);
  assert.match(css, /@media \(max-width: 480px\) \{[^@]*\.daily-chapter-art \{ width: 76px; \}[^@]*scale\(\.5\)/);
  assert.equal(css.match(/^\s+\.daily-chapter-art \.dc-motif\{/gm), null);
});

test("chip rows that scroll share one right-edge fade and keep focus rings", () => {
  const fade = read("src/components/page/surfaceClasses.ts");
  assert.match(fade, /export const SCROLL_FADE = "max-sm:\[mask-image:/);
  for (const f of ["src/pages/DiscoverPage.tsx", "src/components/LibraryToolbar.tsx"]) {
    const group = read(f).match(/<div role="group" aria-label="(?:Type|Status)" className=\{`([^`]*)`\}/)?.[1] ?? "";
    for (const cls of ["-my-1", "py-1", "overflow-x-auto", "${SCROLL_FADE}"]) assert.ok(group.includes(cls), `${f} ${cls}`);
  }
});

test("login mode renders no username hint and the options row keeps its gap above the submit", () => {
  const html = page("/login", createElement(LoginPage));
  assert.doesNotMatch(html, /username-hint/);
  assert.match(html, /<div class="mb-4 flex flex-wrap[^"]*"><label/);
});

test("the sign-in stage leaves color-scheme to the theme", () => {
  assert.doesNotMatch(read("src/auth/AuthStage.tsx"), /color-scheme/);
});
