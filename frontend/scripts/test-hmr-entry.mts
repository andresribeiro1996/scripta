import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer } from "vite";

test("main.tsx is not a Fast Refresh boundary, so a hot update reloads the page instead of mounting a second root", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const server = await createServer({ root, configFile: `${root}/vite.config.ts`, logLevel: "silent", server: { middlewareMode: true, ws: false } });
  try {
    const result = await server.transformRequest("/src/main.tsx");
    assert.ok(result);
    assert.doesNotMatch(result.code, /import\.meta\.hot\.accept/);
  } finally {
    await server.close();
  }
});
