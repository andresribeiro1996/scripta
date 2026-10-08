import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const OPENER = "@media (prefers-reduced-motion: no-preference) {";

function split(css: string): { inside: string; outside: string } {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let inside = "";
  let outside = "";
  let from = 0;
  for (;;) {
    const start = source.indexOf(OPENER, from);
    if (start === -1) break;
    outside += source.slice(from, start);
    let depth = 0;
    let end = start + OPENER.length - 1;
    for (; end < source.length; end++) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}" && --depth === 0) break;
    }
    inside += source.slice(start, end + 1);
    from = end + 1;
  }
  return { inside, outside: outside + source.slice(from) };
}

test("mark entrances and the theme fade only exist for people who didn't ask for less motion", () => {
  const { inside, outside } = split(readFileSync(new URL("../src/index.css", import.meta.url), "utf8"));
  for (const selector of [".mark-scan", ".mark-rise", ".mark-fan .mark-layer", ".mark-register .mark-layer", ".mark-gild .mark-gild-frame", ".mark-gild .mark-gild-mark", ".card-shine-idle", "::view-transition-old(root)", "::view-transition-new(root)"]) {
    assert.ok(inside.includes(selector), `${selector} missing from the no-preference block`);
    assert.ok(!outside.includes(selector), `${selector} applies outside the no-preference block`);
  }
  for (const name of ["scripta-mark-scan", "scripta-mark-rise", "scripta-mark-layer", "scripta-mark-draw", "card-shine-sweep"]) assert.ok(outside.includes(`@keyframes ${name}`), name);
});
