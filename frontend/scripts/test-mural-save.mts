import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMurals } from "../src/hooks/useMurals";
import type { Mural, MuralBlock } from "../src/lib/murals";

const block: MuralBlock = { id: "b", type: "text", heading: "Before", body: "", layout: { x: 0, y: 0, w: 12, h: 2 } };
const mural: Mural = { id: "m", name: "M", theme: "light", blocks: [block], folderId: null, createdAt: "before", updatedAt: "before", shareToken: null, shareUrl: null };

test("mural saves display immediately, persist and roll back failures without replacing newer edits", async () => {
  const originalFetch = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let hook!: ReturnType<typeof useMurals>;
  function Probe() { hook = useMurals(); return null; }
  client.setQueryData(["murals"], [mural]);
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  try {
    for (const outcome of ["success", "failure", "newer failure", "newer success"] as const) {
      client.setQueryData(["murals"], [mural]);
      let respond!: (response: Response) => void;
      let requested!: () => void;
      const request = new Promise<void>((resolve) => { requested = resolve; });
      globalThis.fetch = async (_url, init) => {
        assert.equal(init?.method, "PUT");
        assert.equal(JSON.parse(String(init.body)).blocks[0].heading, "After");
        requested();
        return new Promise<Response>((resolve) => { respond = resolve; });
      };
      const blocks = [{ ...block, heading: "After", layout: { ...block.layout, y: 10 } }];
      const saving = hook.saveBlocks(mural.id, blocks);
      await request;
      assert.equal(hook.currentMural(mural.id)?.blocks[0].heading, "After");
      assert.equal(hook.currentMural(mural.id)?.blocks[0].layout.y, 0);
      if (outcome.startsWith("newer")) client.setQueryData(["murals"], [{ ...mural, blocks: [{ ...block, heading: "Newer" }] }]);
      const succeeds = outcome.endsWith("success");
      respond(Response.json(succeeds ? { ...mural, blocks: [{ ...block, heading: "After" }], updatedAt: "saved" } : { error: "Save failed" }, { status: succeeds ? 200 : 500 }));
      if (succeeds) {
        await saving;
        assert.equal(hook.currentMural(mural.id)?.updatedAt, outcome.startsWith("newer") ? "before" : "saved");
        assert.equal(hook.currentMural(mural.id)?.blocks[0].heading, outcome.startsWith("newer") ? "Newer" : "After");
      } else {
        await assert.rejects(saving, /Save failed/);
        assert.equal(hook.currentMural(mural.id)?.blocks[0].heading, outcome.startsWith("newer") ? "Newer" : "Before");
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});
