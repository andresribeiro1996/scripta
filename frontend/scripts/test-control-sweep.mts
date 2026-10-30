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

const FILL = /<(button|Link|a)\b(?:=>|[^>])*className=\{?[`"][^`"]*bg-\(--color-(accent|danger)\)[^`"]*text-\(--color-on-(accent|danger)\)/s;
const FIELD =
  /<(input|select|textarea)\b(?!(?:=>|[^>])*type="(checkbox|radio|range|file|color)")(?:=>|[^>])*className=\{?[`"][^`"]*border border-\(--color-border\)[^`"]*bg-\(--color-surface\)/s;

test("no button or link hand-rolls an accent or danger fill", () => {
  assert.deepEqual(files().filter((f) => FILL.test(read(f))), []);
});

test("no text field hand-rolls the field chrome", () => {
  assert.deepEqual(files().filter((f) => FIELD.test(read(f))), []);
});
