import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { MuralConflictError, useMurals } from "../src/hooks/useMurals";
import type { Mural, MuralBlock } from "../src/lib/murals";

const layout = { x: 0, y: 0, w: 12, h: 2 };
const textBlock = (heading: string): MuralBlock => ({ id: "b", type: "text", heading, body: "", layout });
const makeMural = (id: string, extra: Partial<Mural> = {}): Mural => ({ id, name: id, theme: "light", blocks: [textBlock("Before")], folderId: null, createdAt: "t0", updatedAt: "t0", shareToken: null, shareUrl: null, ...extra });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

type Call = { method: string; url: string; body: Record<string, unknown>; respond: (response: Response) => void };

function setup(murals: Mural[]) {
  const originalFetch = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const calls: Call[] = [];
  const latest = {} as { hook: ReturnType<typeof useMurals> };
  function Probe() { latest.hook = useMurals(); return null; }
  client.setQueryData(["murals"], murals);
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  globalThis.fetch = (url, init) =>
    new Promise<Response>((resolve) => {
      calls.push({ method: String(init?.method), url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {}, respond: resolve });
    });
  async function answer(index: number, response: Response | ((call: Call) => Response)) {
    while (calls.length <= index) await flush();
    calls[index].respond(typeof response === "function" ? response(calls[index]) : response);
    await flush();
  }
  const restore = () => { globalThis.fetch = originalFetch; client.clear(); };
  return { client, calls, hook: () => latest.hook, answer, restore };
}

test("overlapping saves on one mural are sent one after another with the newest updatedAt", async () => {
  const m = makeMural("serial");
  const { client, calls, hook, answer, restore } = setup([m]);
  try {
    const first = hook().saveBlocks(m.id, [textBlock("A")]);
    const second = hook().saveBlocks(m.id, [textBlock("B")]);
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.updatedAt, "t0");
    await answer(0, Response.json({ ...m, blocks: [textBlock("A")], updatedAt: "t1" }));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.updatedAt, "t1");
    await answer(1, Response.json({ ...m, blocks: [textBlock("B")], updatedAt: "t2" }));
    await Promise.all([first, second]);
    const cached = client.getQueryData<Mural[]>(["murals"])![0];
    assert.equal(cached.updatedAt, "t2");
    assert.equal(cached.blocks[0].type === "text" && cached.blocks[0].heading, "B");
  } finally {
    restore();
  }
});

test("rename, theme, move and block saves each send the updatedAt the previous write returned", async () => {
  const m = makeMural("fields");
  const { calls, hook, answer, restore } = setup([m]);
  try {
    const echo = (n: number) => (call: Call) => Response.json({ ...m, ...call.body, updatedAt: `t${n}` });
    const writes = [
      () => hook().rename(m.id, "Renamed"),
      () => hook().setTheme(m.id, "dark"),
      () => hook().move(m.id, null),
      () => hook().saveBlocks(m.id, [textBlock("After")])
    ];
    for (const [index, write] of writes.entries()) {
      const pending = write();
      await answer(index, echo(index + 1));
      await pending;
      assert.equal(calls[index].method, "PUT");
      assert.equal(calls[index].body.updatedAt, `t${index}`);
    }
  } finally {
    restore();
  }
});

test("scrubBooks sends updatedAt with each changed mural", async () => {
  const spotlight: MuralBlock = { id: "s", type: "spotlight", bookKey: "gone", layout };
  const m = makeMural("scrub-books", { blocks: [spotlight, textBlock("Keep")] });
  const untouched = makeMural("scrub-untouched", { updatedAt: "u0" });
  const { calls, hook, answer, restore } = setup([m, untouched]);
  try {
    const pending = hook().scrubBooks(["gone"]);
    await answer(0, (call) => Response.json({ ...m, ...call.body, updatedAt: "t1" }));
    await pending;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.endsWith("/murals/scrub-books"), true);
    assert.equal(calls[0].body.updatedAt, "t0");
  } finally {
    restore();
  }
});

test("scrubImage clears the cover then sends the blocks with the updatedAt the clear returned", async () => {
  const image: MuralBlock = { id: "i", type: "image", imageId: "img", layout };
  const m = makeMural("scrub-image", { blocks: [image], coverImageId: "img", coverImageUrl: "/img" });
  const { calls, hook, answer, restore } = setup([m]);
  try {
    const pending = hook().scrubImage("img");
    await answer(0, Response.json({ ...m, coverImageId: undefined, coverImageUrl: undefined, updatedAt: "t1" }));
    await answer(1, (call) => Response.json({ ...m, ...call.body, updatedAt: "t2" }));
    await pending;
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[1].method, "PUT");
    assert.equal(calls[1].body.updatedAt, "t1");
  } finally {
    restore();
  }
});

test("a 409 rejects with a message for the user, shows the server's version and drops writes queued behind it", async () => {
  const m = makeMural("conflict");
  const server = makeMural("conflict", { name: "Server", updatedAt: "t9" });
  const { client, calls, hook, answer, restore } = setup([m]);
  let refetches = 0;
  const unsubscribe = new QueryObserver(client, { queryKey: ["murals"], staleTime: Infinity, queryFn: async () => { refetches++; return [server]; } }).subscribe(() => undefined);
  try {
    const first = hook().saveBlocks(m.id, [textBlock("A")]);
    const second = hook().saveBlocks(m.id, [textBlock("B")]);
    const rejections = Promise.all([assert.rejects(first, /changed somewhere else/), assert.rejects(second, MuralConflictError)]);
    await flush();
    assert.equal(calls.length, 1);
    await answer(0, Response.json({ error: "Mural changed.", current: server }, { status: 409 }));
    await rejections;
    assert.equal(calls.length, 1);
    assert.equal(refetches, 1);
    assert.equal(hook().currentMural(m.id)?.name, "Server");
    const later = hook().rename(m.id, "Later");
    await answer(1, (call) => Response.json({ ...server, ...call.body, updatedAt: "t10" }));
    assert.equal((await later).name, "Later");
    assert.equal(calls[1].body.updatedAt, "t9");
  } finally {
    unsubscribe();
    restore();
  }
});

test("a scrub queued behind a save starts from the saved blocks", async () => {
  const gone: MuralBlock = { id: "g", type: "spotlight", bookKey: "gone", layout: { ...layout, y: 2 } };
  const m = makeMural("scrub-after-save", { blocks: [gone, textBlock("Before")] });
  const { client, calls, hook, answer, restore } = setup([m]);
  try {
    const saving = hook().saveBlocks(m.id, [gone, textBlock("Saved")]);
    await flush();
    const scrubbing = hook().scrubBooks(["gone"]);
    await answer(0, (call) => Response.json({ ...m, ...call.body, updatedAt: "t1" }));
    await answer(1, (call) => Response.json({ ...m, ...call.body, updatedAt: "t2" }));
    await Promise.all([saving, scrubbing]);
    assert.deepEqual(calls[1].body.blocks, [textBlock("Saved")]);
    assert.equal(calls[1].body.updatedAt, "t1");
    assert.equal(client.getQueryData<Mural[]>(["murals"])![0].updatedAt, "t2");
  } finally {
    restore();
  }
});

test("a field write ahead of a save does not revert the saved blocks", async () => {
  const m = makeMural("rename-then-save");
  const { client, calls, hook, answer, restore } = setup([m]);
  try {
    const renaming = hook().rename(m.id, "Renamed");
    await flush();
    const saving = hook().saveBlocks(m.id, [textBlock("Saved")]);
    await flush();
    await answer(0, (call) => Response.json({ ...m, ...call.body, updatedAt: "t1" }));
    await answer(1, (call) => Response.json({ ...m, ...call.body, name: "Renamed", updatedAt: "t2" }));
    await Promise.all([renaming, saving]);
    const cached = client.getQueryData<Mural[]>(["murals"])![0];
    assert.equal(cached.blocks[0].type === "text" && cached.blocks[0].heading, "Saved");
    assert.equal(cached.updatedAt, "t2");
    assert.equal(calls[1].body.updatedAt, "t1");
  } finally {
    restore();
  }
});

test("an in-flight refetch is cancelled before a write is sent", async () => {
  const m = makeMural("refetch");
  const { client, calls, hook, answer, restore } = setup([m]);
  let aborted = false;
  const refetching = client.fetchQuery({
    queryKey: ["murals"],
    staleTime: 0,
    queryFn: ({ signal }) => new Promise<Mural[]>((_resolve, reject) => { signal.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }); })
  });
  refetching.catch(() => undefined);
  try {
    const renaming = hook().rename(m.id, "Renamed");
    await answer(0, (call) => Response.json({ ...m, ...call.body, updatedAt: "t1" }));
    await renaming;
    assert.equal(aborted, true);
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test("writes to different murals are not serialized behind each other", async () => {
  const a = makeMural("parallel-a");
  const b = makeMural("parallel-b");
  const { calls, hook, answer, restore } = setup([a, b]);
  try {
    const first = hook().saveBlocks(a.id, [textBlock("A")]);
    const second = hook().saveBlocks(b.id, [textBlock("B")]);
    await flush();
    assert.equal(calls.length, 2);
    await answer(0, (call) => Response.json({ ...a, ...call.body, updatedAt: "ta" }));
    await answer(1, (call) => Response.json({ ...b, ...call.body, updatedAt: "tb" }));
    await Promise.all([first, second]);
  } finally {
    restore();
  }
});
