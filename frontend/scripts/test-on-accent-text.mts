import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const FILLS = ["bg-(--color-accent)", "bg-(--color-danger)"];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

test("no class string puts hardcoded white text on an accent or danger fill", () => {
  const offenders: string[] = [];
  for (const file of tsxFiles(SRC)) {
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      for (const segment of line.split(/["`]|\$\{|\}/)) {
        if (FILLS.some((fill) => segment.includes(fill)) && /\btext-white\b/.test(segment)) offenders.push(`${file.slice(SRC.length)}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [], "use text-(--color-on-accent) on accent fills and text-(--color-on-danger) on danger fills");
});
