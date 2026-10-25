import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useArena } from "../src/hooks/useArena";

test("refetching an unsaved draft tournament requests nothing", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return Response.json({ error: "Unexpected request" }, { status: 400 });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let hook!: ReturnType<typeof useArena>;
  function Probe() { hook = useArena(""); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  try {
    await hook.refetch();
    assert.deepEqual(requested, []);
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});
