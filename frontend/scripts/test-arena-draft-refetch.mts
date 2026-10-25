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

async function withHook<T>(fetchImpl: typeof fetch, run: (hook: ReturnType<typeof useArena>, client: QueryClient) => Promise<T>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let hook!: ReturnType<typeof useArena>;
  function Probe() { hook = useArena(""); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  try {
    return await run(hook, client);
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
}

const key = ["arena", "t1", "tok"];
const options = { queryKey: key, queryFn: async () => (await fetch("http://x/arenas/t1")).json() as Promise<{ slots: number[] }> };

test("refresh requests nothing for an empty id", async () => {
  const requested: string[] = [];
  await withHook(async (url) => { requested.push(String(url)); return Response.json({}); }, async (hook) => {
    await hook.refresh("");
    assert.deepEqual(requested, []);
  });
});

test("refresh discards a still-pending pre-write fetch and keeps the post-write data", async () => {
  let calls = 0;
  let resolveFirst!: (response: Response) => void;
  await withHook(async () => {
    calls++;
    if (calls === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve; });
    return Response.json({ slots: [1] });
  }, async (hook, client) => {
    const unsubscribe = new QueryObserver(client, options).subscribe(() => {});
    assert.equal(calls, 1);
    const refreshing = hook.refresh("t1");
    resolveFirst(Response.json({ slots: [] }));
    await refreshing;
    assert.deepEqual(client.getQueryData(key), { slots: [1] });
    unsubscribe();
  });
});

test("refresh rejects when the refetch fails", async () => {
  await withHook(async () => Response.json({ slots: [] }), async (hook, client) => {
    const unsubscribe = new QueryObserver(client, { ...options, queryFn: async () => { throw new Error("Unavailable"); }, staleTime: Infinity }).subscribe(() => {});
    client.setQueryData(key, { slots: [] });
    await assert.rejects(hook.refresh("t1"), /Unavailable/);
    unsubscribe();
  });
});
