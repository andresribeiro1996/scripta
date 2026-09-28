import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("only ui/Text.tsx imports Text from react-native", () => {
  const offenders = sources("src").filter((file) => {
    if (file === join("src", "ui", "Text.tsx")) return false;
    const imports = readFileSync(file, "utf8").match(/import\s*\{[^}]*\}\s*from\s*"react-native"/g) ?? [];
    return imports.some((clause) => /[{,]\s*Text\s*[,}]/.test(clause));
  });
  assert.deepEqual(offenders, []);
});
