import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { createServer, type HotPayload } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

function devServer() {
  return createServer({ root, configFile: `${root}/vite.config.ts`, logLevel: "silent", server: { middlewareMode: true, ws: false } });
}

test("main.tsx is not a Fast Refresh boundary, so a hot update reloads the page instead of mounting a second root", async () => {
  const server = await devServer();
  try {
    const result = await server.transformRequest("/src/main.tsx");
    assert.ok(result);
    assert.doesNotMatch(result.code, /import\.meta\.hot\.accept/);
  } finally {
    await server.close();
  }
});

test("a burst of @scripta/shared dist changes becomes one full reload, not a hot update per file", async () => {
  const server = await devServer();
  try {
    const sent: HotPayload[] = [];
    const hot = server.environments.client.hot;
    const send = hot.send.bind(hot);
    hot.send = ((payload: HotPayload) => {
      sent.push(payload);
      send(payload);
    }) as typeof hot.send;
    const dist = fileURLToPath(new URL("../../packages/shared/dist/", import.meta.url));
    for (const file of ["index.js", "themes/index.js", "library/index.js"]) server.watcher.emit("change", `${dist}${file}`);
    await sleep(600);
    assert.deepEqual(sent.map((payload) => payload.type), ["full-reload"]);
  } finally {
    await server.close();
  }
});
