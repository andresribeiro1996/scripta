import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildLaunchConfig, writeLaunchConfig } from "./devLaunchConfig.mjs";

const ports = { backend: 3200, vite: 5373, metro: 8281 };

test("web and api entries carry the slot's ports, with an http origin", () => {
  const { configurations } = buildLaunchConfig({ ports, https: false });
  assert.deepEqual(configurations, [
    { name: "web", runtimeExecutable: "npm", runtimeArgs: ["run", "frontend"], port: 5373, url: "http://localhost:5373" },
    { name: "api", runtimeExecutable: "npm", runtimeArgs: ["run", "backend"], port: 3200 },
  ]);
});

test("web url uses https when the dev certs exist", () => {
  const web = buildLaunchConfig({ ports, https: true }).configurations[0];
  assert.equal(web.url, "https://localhost:5373");
});

test("writeLaunchConfig creates .claude and writes launch.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "scripta-launch-"));
  try {
    writeLaunchConfig({ repoRoot: dir, ports, https: false });
    const written = JSON.parse(readFileSync(join(dir, ".claude", "launch.json"), "utf8"));
    assert.deepEqual(written, buildLaunchConfig({ ports, https: false }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
