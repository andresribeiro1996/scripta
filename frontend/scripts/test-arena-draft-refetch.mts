import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryObserver, QueryClientProvider } from "@tanstack/react-query";
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

test("refreshing a saved draft's new id refetches that tournament, and an empty id requests nothing", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (url) => {
    requested.push(new URL(String(url)).pathname);
    return Response.json({ error: "Unavailable" }, { status: 500 });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let hook!: ReturnType<typeof useArena>;
  function Probe() { hook = useArena(""); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  const observer = new QueryObserver(client, { queryKey: ["arena", "t1", "tok"], queryFn: async () => { await fetch("http://x/arenas/t1"); return 1; }, staleTime: Infinity });
  client.setQueryData(["arena", "t1", "tok"], 0);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await hook.refresh("");
    assert.deepEqual(requested, []);
    await hook.refresh("t1");
    assert.deepEqual(requested, ["/arenas/t1"]);
  } finally {
    globalThis.fetch = originalFetch;
    unsubscribe();
    client.clear();
  }
});
