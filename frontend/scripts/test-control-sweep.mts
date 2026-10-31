import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const ROOT = new URL("../src/", import.meta.url).pathname;
const CLASS_MODULES = ["components/page/buttonClasses.ts", "components/page/surfaceClasses.ts"];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function files(): string[] {
  return walk(ROOT)
    .map((p) => relative(ROOT, p))
    .filter((f) => f.endsWith(".tsx") && !f.startsWith("components/landing/") && !CLASS_MODULES.includes(f));
}

const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

const EXEMPT = ["auth/PasswordInput.tsx"];

function elements(src: string, tag: RegExp): string[] {
  return [...src.matchAll(new RegExp(`<(?:${tag.source})\\b(?:=>|[^>])*>`, "gs"))].map((m) => m[0]);
}

function classNames(el: string): string[] {
  return [...el.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)].map((m) => m[1]);
}

const hasFill = (c: string) => /bg-\(--color-(accent|danger)\)/.test(c) && /text-\(--color-on-(accent|danger)\)/.test(c);
const hasFieldChrome = (c: string) => /(?:^|\s)border(?:-|\s|$)/.test(c) && /(?:^|\s)rounded/.test(c);
const SKIPPED_TYPE = /type="(checkbox|radio|range|file|color)"/;

test("no button or link hand-rolls an accent or danger fill", () => {
  const offenders = files().filter((f) => elements(read(f), /button|Link|a/).some((el) => classNames(el).some(hasFill)));
  assert.deepEqual(offenders, []);
});

test("no text field hand-rolls the field chrome", () => {
  const offenders = files()
    .filter((f) => !EXEMPT.includes(f))
    .filter((f) => elements(read(f), /input|select|textarea/).some((el) => !SKIPPED_TYPE.test(el) && classNames(el).some(hasFieldChrome)));
  assert.deepEqual(offenders, []);
});
