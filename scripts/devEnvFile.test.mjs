import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultEnvLine, upsertEnvLine } from "./devEnvFile.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "scripta-devEnvFile-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("defaultEnvLine writes the key when the file doesn't exist", () => {
  withTempDir((dir) => {
    const path = join(dir, ".env.local");
    defaultEnvLine(path, "EXPO_PUBLIC_API_URL", "http://127.0.0.1:3000");
    assert.equal(readFileSync(path, "utf8"), "EXPO_PUBLIC_API_URL=http://127.0.0.1:3000\n");
  });
});

test("defaultEnvLine writes the key when the file exists but lacks it", () => {
  withTempDir((dir) => {
    const path = join(dir, ".env.local");
    writeFileSync(path, "OTHER_KEY=1\n");
    defaultEnvLine(path, "EXPO_PUBLIC_API_URL", "http://127.0.0.1:3000");
    assert.equal(readFileSync(path, "utf8"), "OTHER_KEY=1\nEXPO_PUBLIC_API_URL=http://127.0.0.1:3000\n");
  });
});

test("defaultEnvLine never clobbers an existing value for that key", () => {
  withTempDir((dir) => {
    const path = join(dir, ".env.local");
    writeFileSync(path, "EXPO_PUBLIC_API_URL=http://192.168.1.10:3000\n");
    defaultEnvLine(path, "EXPO_PUBLIC_API_URL", "http://127.0.0.1:3000");
    assert.equal(readFileSync(path, "utf8"), "EXPO_PUBLIC_API_URL=http://192.168.1.10:3000\n");
  });
});
