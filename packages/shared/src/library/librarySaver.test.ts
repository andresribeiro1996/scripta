import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLibraryChange, type LibraryChange } from "./libraryChange.js";
import { createLibrarySaver, type LibraryChangeAnswer, type LibrarySaverDeps } from "./librarySaver.js";
import { bookKey } from "./merge.js";
import { saveFailureMessage } from "./saveFailure.js";
import type { LibraryData, LibraryDocument } from "./types.js";

class StatusError extends Error {
  constructor(readonly status: number, message = `Request failed (${status})`) {
    super(message);
  }
}

const STAMP = "2020-01-01T00:00:00.000Z";
const version = (n: number) => new Date(Date.UTC(2026, 9, 2, 12, 0, n)).toISOString();
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const dune = { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 0 };
const emma = { Title: "Emma", Attribution: "Jane Austen", ReadStatus: 0 };
const duneKey = bookKey(dune);
const emmaKey = bookKey(emma);

function shelf(): LibraryData {
  return {
    name: "Mine",
    books: [dune, emma],
    groups: [{ id: "g1", type: "collection", name: "Favourites", bookKeys: [], createdAt: STAMP, updatedAt: STAMP }]
  };
}

const tick = (key: string, member = true): LibraryChange => ({ kind: "membership", groupId: "g1", bookKey: key, member });
const keysIn = (data: LibraryData | undefined) => data?.groups?.find((g) => g.id === "g1")?.bookKeys ?? [];
const keysOf = (document: LibraryDocument | null | undefined) => keysIn(document?.data);
const titles = (data: LibraryData | undefined) => data?.books.map((book) => String(book.Title));

function server(initial?: LibraryData) {
  let counter = 0;
  let doc: LibraryDocument | null = null;
  function commit(data: LibraryData): LibraryDocument {
    doc = { data, updatedAt: version(++counter), shareToken: doc?.shareToken ?? null, shareUrl: doc?.shareUrl ?? null };
    return doc;
  }
  if (initial) commit(initial);
  return {
    get doc() {
      return doc;
    },
    commit,
    send(change: LibraryChange): LibraryChangeAnswer {
      const base = doc?.updatedAt ?? null;
      const result = applyLibraryChange(doc?.data ?? { books: [] }, change);
      if ("error" in result) throw new StatusError(404, result.error);
      return { updatedAt: result.changed ? commit(result.data).updatedAt : base!, baseUpdatedAt: base };
    },
    put(data: LibraryData, expected: string | undefined): LibraryDocument {
      if (doc?.updatedAt !== expected) throw new StatusError(409, "The library changed elsewhere.");
      return commit(data);
    }
  };
}

type Server = ReturnType<typeof server>;
type Overrides = Partial<Pick<LibrarySaverDeps, "send" | "put" | "fetch">>;

function harness(srv: Server, overrides: Overrides = {}) {
  const sent: LibraryChange[] = [];
  const puts: Array<{ data: LibraryData; expected: string | undefined; source: "import" | undefined }> = [];
  const writes: Array<LibraryDocument | null> = [];
  const fetches = { count: 0 };
  const saver = createLibrarySaver({
    send: (change, signal) => {
      sent.push(change);
      return overrides.send ? overrides.send(change, signal) : Promise.resolve().then(() => srv.send(change));
    },
    put: (data, expected, source, signal) => {
      puts.push({ data, expected, source });
      return overrides.put ? overrides.put(data, expected, source, signal) : Promise.resolve().then(() => srv.put(data, expected));
    },
    fetch: (signal) => {
      fetches.count++;
      return overrides.fetch ? overrides.fetch(signal) : Promise.resolve(srv.doc);
    },
    write: (view) => {
      writes.push(view);
    }
  });
  return { saver, sent, puts, writes, fetches, last: () => writes.at(-1) };
}

test("a tick shows at once, and when the server applied it to this very copy the copy takes the new version", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv);
  await h.saver.fetch();
  const before = h.writes.length;

  const ticking = h.saver.submit(tick(duneKey));
  assert.equal(h.writes.length, before + 1);
  assert.deepEqual(keysOf(h.last()), [duneKey]);
  assert.equal(h.last()!.updatedAt, version(1));

  assert.equal((await ticking).ok, true);
  assert.equal(h.writes.length, before + 2);
  assert.equal(h.last()!.updatedAt, version(2));
  assert.deepEqual(keysOf(h.last()), [duneKey]);
  assert.equal(h.saver.hasPending(), false);
  assert.equal(h.fetches.count, 1);

  await h.saver.saveWhole((data) => ({ ...data, name: "Renamed" }));
  assert.deepEqual(h.puts.map((put) => put.expected), [version(2)]);
  assert.deepEqual(keysIn(h.puts[0]!.data), [duneKey]);
  assert.equal(h.fetches.count, 1);
});

test("two devices: a copy that is behind keeps its version, and the next whole save gets a 409 and loses nothing", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  let stale: LibraryDocument | null = null;
  const h = harness(srv, { fetch: async () => stale ?? srv.doc });
  await h.saver.fetch();
  stale = srv.doc;
  srv.commit({ ...srv.doc!.data, books: [...srv.doc!.data.books, { Title: "Neuromancer", Attribution: "William Gibson" }] });

  assert.equal((await h.saver.submit(tick(duneKey))).ok, true);
  await flush();
  assert.equal(srv.doc!.updatedAt, version(3));
  assert.equal(h.last()!.updatedAt, version(1));
  assert.deepEqual(keysOf(h.last()), [duneKey]);
  assert.equal(h.saver.hasPending(), false);

  stale = null;
  await h.saver.saveWhole((data) => ({ ...data, name: "Renamed" }));
  assert.deepEqual(h.puts.map((put) => put.expected), [version(1), version(3)]);
  assert.equal(srv.doc!.data.name, "Renamed");
  assert.equal(srv.doc!.data.books.length, 3);
  assert.deepEqual(keysOf(srv.doc), [duneKey]);
  assert.equal(h.saver.hasPending(), false);
});

test("a stale service-worker copy: stale answers are ignored, the tick stays shown, and the next whole save gets a 409", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const cached = srv.doc!;
  srv.commit({ ...cached.data, name: "Renamed on the phone" });
  let stale: LibraryDocument | null = cached;
  const h = harness(srv, { fetch: async () => stale ?? srv.doc });
  const loaded = await h.saver.fetch();
  assert.equal(loaded!.updatedAt, version(1));

  assert.equal((await h.saver.submit(tick(duneKey))).ok, true);
  await flush();
  const refetched = await h.saver.fetch();
  assert.equal(refetched!.updatedAt, version(1));
  assert.deepEqual(keysOf(refetched), [duneKey]);
  assert.equal(refetched!.data.name, "Mine");
  assert.equal(h.saver.hasPending(), false);

  stale = null;
  await h.saver.saveWhole((data) => ({ ...data, distinctBooks: [[duneKey, emmaKey]] }));
  assert.deepEqual(h.puts.map((put) => put.expected), [version(1), version(3)]);
  assert.equal(srv.doc!.data.name, "Renamed on the phone");
  assert.deepEqual(srv.doc!.data.distinctBooks, [[duneKey, emmaKey]]);
  assert.deepEqual(keysOf(srv.doc), [duneKey]);
});

test("a stale copy that is revalidated later replaces the copy and drops the tick it already holds", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const cached = srv.doc!;
  srv.commit({ ...cached.data, name: "Renamed on the phone" });
  let stale: LibraryDocument | null = cached;
  const h = harness(srv, { fetch: async () => stale ?? srv.doc });
  await h.saver.fetch();
  await h.saver.submit(tick(duneKey));
  await flush();
  assert.equal(h.saver.hasPending(), false);

  stale = null;
  const revalidated = await h.saver.fetch();
  assert.equal(revalidated!.updatedAt, version(3));
  assert.equal(revalidated!.data.name, "Renamed on the phone");
  assert.deepEqual(keysOf(revalidated), [duneKey]);
  assert.equal(h.saver.hasPending(), false);

  await h.saver.saveWhole((data) => ({ ...data, distinctBooks: [[duneKey, emmaKey]] }));
  assert.deepEqual(h.puts.map((put) => put.expected), [version(3)]);
});

test("a rename racing a tick: the other device's rename lands while the tick is in flight and is not undone by the next save", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const gate = deferred();
  let stale: LibraryDocument | null = null;
  const h = harness(srv, {
    send: async (change) => {
      await gate.promise;
      return srv.send(change);
    },
    fetch: async () => stale ?? srv.doc
  });
  await h.saver.fetch();
  stale = srv.doc;

  const ticking = h.saver.submit(tick(duneKey));
  await flush();
  srv.commit({ ...srv.doc!.data, name: "Renamed on the phone" });
  gate.resolve();
  assert.equal((await ticking).ok, true);
  await flush();
  assert.equal(srv.doc!.updatedAt, version(3));
  assert.equal(h.last()!.data.name, "Mine");
  assert.equal(h.last()!.updatedAt, version(1));

  stale = null;
  await h.saver.saveWhole((data) => ({ ...data, distinctBooks: [[duneKey, emmaKey]] }));
  assert.deepEqual(h.puts.map((put) => put.expected), [version(1), version(3)]);
  assert.equal(srv.doc!.data.name, "Renamed on the phone");
  assert.deepEqual(keysOf(srv.doc), [duneKey]);
});

for (const failFirst of [false, true]) {
  test(`on-off-on never shows off after the last tap${failFirst ? ", and ends on when the first save fails" : ""}`, { timeout: 5000 }, async () => {
    const srv = server(shelf());
    const gates = [deferred(), deferred(), deferred()];
    let calls = 0;
    const h = harness(srv, {
      send: async (change) => {
        await gates[calls++]!.promise;
        return srv.send(change);
      }
    });
    await h.saver.fetch();

    const taps = [h.saver.submit(tick(duneKey, true)), h.saver.submit(tick(duneKey, false)), h.saver.submit(tick(duneKey, true))];
    const lastTap = h.writes.length - 1;
    assert.deepEqual(keysOf(h.last()), [duneKey]);
    await flush();
    if (failFirst) gates[0]!.reject(new StatusError(500));
    else gates[0]!.resolve();
    await flush();
    gates[1]!.resolve();
    await flush();
    gates[2]!.resolve();

    assert.deepEqual((await Promise.all(taps)).map((r) => r.ok), [!failFirst, true, true]);
    await flush();
    for (const view of h.writes.slice(lastTap)) assert.deepEqual(keysOf(view), [duneKey]);
    assert.deepEqual(keysOf(srv.doc), [duneKey]);
    assert.deepEqual(keysOf(h.last()), [duneKey]);
  });
}

test("pending ticks survive a document landing mid-queue, and a receive is not held behind the queue", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const gate = deferred();
  const h = harness(srv, {
    send: async (change) => {
      await gate.promise;
      return srv.send(change);
    }
  });
  await h.saver.fetch();
  const first = h.saver.submit(tick(duneKey));
  const second = h.saver.submit(tick(emmaKey));
  await flush();

  const other = srv.commit({ ...srv.doc!.data, name: "Renamed on the phone" });
  h.saver.receive(other);
  assert.equal(h.last()!.updatedAt, other.updatedAt);
  assert.equal(h.last()!.data.name, "Renamed on the phone");
  assert.deepEqual(keysOf(h.last()), [duneKey, emmaKey]);
  assert.equal(h.saver.hasPending(), true);
  const view = await h.saver.fetch();
  assert.deepEqual(keysOf(view), [duneKey, emmaKey]);

  gate.resolve();
  assert.deepEqual([(await first).ok, (await second).ok], [true, true]);
  assert.equal(h.fetches.count, 2);
  assert.deepEqual(keysOf(h.last()), [duneKey, emmaKey]);
  assert.equal(h.last()!.updatedAt, srv.doc!.updatedAt);
  assert.equal(h.saver.hasPending(), false);
});

for (const [label, answer] of [
  ["an older copy", (older: LibraryDocument) => Promise.resolve(older)],
  ["no answer at all", () => Promise.reject(new Error("offline"))],
  ["a fetch that never comes back", () => new Promise<LibraryDocument | null>(() => {})]
] as const) {
  test(`a failed change rolls back without the fetch's help: ${label}`, { timeout: 5000 }, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const srv = server(shelf());
    const older = srv.doc!;
    srv.commit({ ...older.data, name: "Renamed on the phone" });
    let loaded = false;
    const h = harness(srv, {
      send: async () => {
        throw new StatusError(500);
      },
      fetch: async () => {
        if (!loaded) {
          loaded = true;
          return srv.doc;
        }
        return answer(older);
      }
    });
    await h.saver.fetch();

    const ticking = h.saver.submit(tick(duneKey));
    assert.deepEqual(keysOf(h.last()), [duneKey]);
    assert.equal((await ticking).ok, false);
    assert.deepEqual(keysOf(h.last()), []);
    assert.equal(h.last()!.updatedAt, version(2));
    assert.equal(h.saver.hasPending(), false);
    await flush();
    assert.deepEqual(keysOf(h.last()), []);
    assert.equal(h.fetches.count, 2);
  });
}

test("a failed change does not stop the changes queued behind it", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  let calls = 0;
  const h = harness(srv, {
    send: async (change) => {
      if (calls++ === 0) throw new StatusError(429, "Too Many Requests");
      return srv.send(change);
    }
  });
  await h.saver.fetch();
  const results = await Promise.all([h.saver.submit(tick(duneKey)), h.saver.submit(tick(emmaKey))]);
  assert.deepEqual(results.map((r) => r.ok), [false, true]);
  assert.deepEqual(keysOf(srv.doc), [emmaKey]);
  assert.deepEqual(keysOf(h.last()), [emmaKey]);
});

test("a document older than the copy or at its version is ignored, a newer one replaces it, and a first one is always taken", () => {
  const srv = server(shelf());
  const v1 = srv.doc!;
  const v2 = srv.commit({ ...v1.data, name: "Two" });
  const v3 = srv.commit({ ...v1.data, name: "Three" });
  const h = harness(srv);

  h.saver.receive(v2);
  assert.equal(h.last()!.data.name, "Two");
  assert.equal(h.writes.length, 1);

  h.saver.receive(v1);
  h.saver.receive({ ...v2, data: { ...v2.data, name: "Same version, other data" } });
  assert.equal(h.writes.length, 1);
  assert.equal(h.last()!.data.name, "Two");

  h.saver.receive(v3);
  assert.equal(h.writes.length, 2);
  assert.equal(h.last()!.data.name, "Three");
  assert.equal(h.last()!.updatedAt, v3.updatedAt);
});

test("share and unshare always apply their token, and a stale copy at the same version cannot bring an old one back", async () => {
  const srv = server(shelf());
  const h = harness(srv);
  const loaded = (await h.saver.fetch())!;

  h.saver.receiveShare({ ...loaded, shareToken: "t1", shareUrl: "https://atmyshelf.test/t1" });
  assert.equal(h.last()!.shareToken, "t1");
  assert.equal(h.last()!.shareUrl, "https://atmyshelf.test/t1");
  assert.equal(h.last()!.updatedAt, loaded.updatedAt);

  const writes = h.writes.length;
  h.saver.receive(loaded);
  assert.equal(h.writes.length, writes);
  assert.equal(h.last()!.shareToken, "t1");

  h.saver.receiveShare({ ...loaded, shareToken: null, shareUrl: null });
  assert.equal(h.last()!.shareToken, null);
  assert.equal(h.last()!.shareUrl, null);
});

test("a share response applies its token to a copy ahead of it without moving the copy, and keeps pending changes shown", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const gate = deferred();
  const h = harness(srv, {
    send: async (change) => {
      await gate.promise;
      return srv.send(change);
    }
  });
  const loaded = (await h.saver.fetch())!;
  const ticking = h.saver.submit(tick(duneKey));
  await flush();

  const newer = srv.commit({ ...loaded.data, name: "Renamed on the phone" });
  h.saver.receive(newer);
  h.saver.receiveShare({ ...loaded, shareToken: "t1", shareUrl: "https://atmyshelf.test/t1" });
  assert.equal(h.last()!.shareToken, "t1");
  assert.equal(h.last()!.updatedAt, newer.updatedAt);
  assert.equal(h.last()!.data.name, "Renamed on the phone");
  assert.deepEqual(keysOf(h.last()), [duneKey]);

  gate.resolve();
  assert.equal((await ticking).ok, true);
  assert.equal(h.last()!.shareToken, "t1");
});

test("a share response newer than the copy replaces it", async () => {
  const srv = server(shelf());
  const h = harness(srv);
  await h.saver.fetch();
  const newer = srv.commit({ ...srv.doc!.data, name: "Renamed on the phone" });
  h.saver.receiveShare({ ...newer, shareToken: "t1", shareUrl: "https://atmyshelf.test/t1" });
  assert.equal(h.last()!.updatedAt, newer.updatedAt);
  assert.equal(h.last()!.data.name, "Renamed on the phone");
  assert.equal(h.last()!.shareToken, "t1");
});

test("an add seeding a series is never folded into the copy: the fetched document replaces it, so ticks use the server's group id", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv);
  await h.saver.fetch();
  const neuromancer = { Title: "Neuromancer", Attribution: "William Gibson", Series: "Sprawl", ReadStatus: 0 };

  const adding = h.saver.submit({ kind: "add", book: neuromancer });
  const seededHere = h.last()!.data.groups!.find((g) => g.type === "series")!;
  assert.deepEqual(titles(h.last()!.data), ["Dune", "Emma", "Neuromancer"]);
  assert.equal((await adding).ok, true);
  await flush();

  assert.equal(h.fetches.count, 2);
  const seededThere = srv.doc!.data.groups!.find((g) => g.type === "series")!;
  assert.notEqual(seededThere.id, seededHere.id);
  const shown = h.last()!;
  assert.equal(shown.updatedAt, srv.doc!.updatedAt);
  const seriesId = shown.data.groups!.find((g) => g.type === "series")!.id;
  assert.equal(seriesId, seededThere.id);
  assert.equal(h.saver.hasPending(), false);

  assert.equal((await h.saver.submit({ kind: "membership", groupId: seriesId, bookKey: duneKey, member: true })).ok, true);
  assert.deepEqual(srv.doc!.data.groups!.find((g) => g.id === seriesId)!.bookKeys, [bookKey(neuromancer), duneKey]);
});

test("an add to an account with no library yet shows at once and is replaced by the fetched document", { timeout: 5000 }, async () => {
  const srv = server();
  const h = harness(srv);
  assert.equal(await h.saver.fetch(), null);
  assert.equal(h.writes.length, 0);

  const adding = h.saver.submit({ kind: "add", book: { Title: "Emma", Attribution: "Jane Austen" } });
  assert.deepEqual(titles(h.last()!.data), ["Emma"]);
  assert.equal((await adding).ok, true);
  await flush();
  assert.equal(h.fetches.count, 2);
  assert.equal(h.last()!.updatedAt, version(1));
  assert.deepEqual(titles(h.last()!.data), ["Emma"]);
  assert.equal(h.saver.hasPending(), false);
});

test("a failed add leaves nothing behind in an account with no library", { timeout: 5000 }, async () => {
  const srv = server();
  const h = harness(srv, {
    send: async () => {
      throw new StatusError(413, "Your library is over 10 MB.");
    }
  });
  await h.saver.fetch();
  assert.equal((await h.saver.submit({ kind: "add", book: { Title: "Emma", Attribution: "Jane Austen" } })).ok, false);
  assert.equal(h.last(), null);
  assert.equal(h.saver.hasPending(), false);
});

test("changes, whole saves and merges run one at a time, in the order they were made", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const events: string[] = [];
  const gates: Array<Deferred<void>> = [];
  let active = 0;
  let busiest = 0;
  async function step<T>(name: string, run: () => T): Promise<T> {
    active++;
    busiest = Math.max(busiest, active);
    events.push(name);
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
    active--;
    return run();
  }
  const h = harness(srv, {
    send: (change) => step("send", () => srv.send(change)),
    put: (data, expected) => step("put", () => srv.put(data, expected))
  });
  await h.saver.fetch();

  const merged: Array<string | undefined> = [];
  const results = [
    h.saver.submit(tick(duneKey)),
    h.saver.saveWhole((data) => ({ ...data, name: "Renamed" })),
    h.saver.submit(tick(emmaKey)),
    h.saver.merge((expected) =>
      step("merge", () => {
        merged.push(expected);
        return srv.put({ ...srv.doc!.data, name: "Merged" }, expected);
      })
    )
  ];
  for (let released = 0; released < 4; released++) {
    await flush();
    assert.equal(gates.length, released + 1);
    gates[released]!.resolve();
  }
  const [first, whole, third, mergedDocument] = await Promise.all(results);

  assert.deepEqual(events, ["send", "put", "send", "merge"]);
  assert.equal(busiest, 1);
  assert.deepEqual([first, third], [{ ok: true }, { ok: true }]);
  assert.equal((whole as LibraryDocument).data.name, "Renamed");
  assert.equal((mergedDocument as LibraryDocument).data.name, "Merged");
  assert.deepEqual(h.puts.map((put) => put.expected), [version(2)]);
  assert.deepEqual(merged, [version(4)]);
  assert.equal(h.last()!.data.name, "Merged");
  assert.deepEqual(keysOf(h.last()), [duneKey, emmaKey]);
  assert.equal(h.saver.hasPending(), false);
});

test("a whole save is uploaded from the confirmed copy, not from taps still queued behind it", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const gate = deferred();
  const h = harness(srv, {
    put: async (data, expected) => {
      await gate.promise;
      return srv.put(data, expected);
    }
  });
  await h.saver.fetch();

  const saving = h.saver.saveWhole((data) => ({ ...data, name: "Renamed" }));
  const ticking = h.saver.submit(tick(duneKey));
  await flush();
  assert.deepEqual(keysOf(h.last()), [duneKey]);
  assert.deepEqual(keysIn(h.puts[0]!.data), []);
  assert.equal(h.sent.length, 0);

  gate.resolve();
  await saving;
  assert.equal((await ticking).ok, true);
  assert.equal(srv.doc!.data.name, "Renamed");
  assert.deepEqual(keysOf(srv.doc), [duneKey]);
  assert.deepEqual(keysOf(h.last()), [duneKey]);
  assert.equal(h.last()!.data.name, "Renamed");
});

test("a stale whole save refetches and reapplies once", { timeout: 5000 }, async () => {
  const srv = server({ books: [], name: "Old" });
  const h = harness(srv);
  await h.saver.fetch();
  srv.commit({ books: [{ Title: "Remote" }], name: "Old" });

  const saved = await h.saver.saveWhole((data) => ({ ...data, name: "Local" }));
  assert.deepEqual(h.puts.map((put) => put.expected), [version(1), version(2)]);
  assert.equal(saved.data.name, "Local");
  assert.equal(saved.data.books[0]!.Title, "Remote");
  assert.equal(h.last()!.updatedAt, saved.updatedAt);
});

test("a replay inside a whole save does not deadlock on the queue, and the jobs behind it run", { timeout: 2000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv);
  await h.saver.fetch();
  srv.commit({ ...srv.doc!.data, name: "Renamed on the phone" });

  const saving = h.saver.saveWhole((data) => ({ ...data, distinctBooks: [[duneKey, emmaKey]] }));
  const ticking = h.saver.submit(tick(duneKey));
  const saved = await saving;
  assert.equal((await ticking).ok, true);
  assert.deepEqual(h.puts.map((put) => put.expected), [version(1), version(2)]);
  assert.equal(saved.data.name, "Renamed on the phone");
  assert.deepEqual(keysOf(srv.doc), [duneKey]);
});

test("a whole save that fails for any reason but a conflict is not retried", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const failure = new StatusError(500);
  const h = harness(srv, {
    put: async () => {
      throw failure;
    }
  });
  await h.saver.fetch();
  await assert.rejects(h.saver.saveWhole((data) => ({ ...data, name: "Local" })), (error) => error === failure);
  assert.equal(h.puts.length, 1);
  assert.equal(h.fetches.count, 1);
});

test("an oversized library reaches the caller with the server's message and is not retried", { timeout: 5000 }, async () => {
  const message = "Your library is over 10 MB, the most Scripta can store. Remove some books or highlights and try again.";
  const srv = server(shelf());
  const h = harness(srv, {
    put: async () => {
      throw new StatusError(413, message);
    }
  });
  await h.saver.fetch();
  const error = await h.saver.saveWhole((data) => ({ ...data, name: "Local" })).catch((reason: unknown) => reason);
  assert.equal(saveFailureMessage(error, "Couldn't save the new name."), message);
  assert.equal(h.puts.length, 1);
  assert.equal(h.fetches.count, 1);
});

test("a cold copy cannot replace an existing remote library", { timeout: 5000 }, async () => {
  const srv = server({ books: [{ Title: "Remote" }] });
  const h = harness(srv);

  const saved = await h.saver.saveWhole((data) => ({ ...data, name: "Local" }));
  assert.deepEqual(h.puts.map((put) => put.expected), [undefined, version(1)]);
  assert.equal(saved.data.books[0]!.Title, "Remote");
  assert.equal(saved.data.name, "Local");
});

test("a first save in an account with no library is sent without a version", { timeout: 5000 }, async () => {
  const srv = server();
  const h = harness(srv);
  await h.saver.fetch();
  const saved = await h.saver.saveWhole((data) => ({ ...data, name: "Mine" }), { source: "import" });
  assert.deepEqual(h.puts.map((put) => [put.expected, put.source]), [[undefined, "import"]]);
  assert.equal(saved.updatedAt, version(1));
  assert.equal(h.last()!.data.name, "Mine");
});

test("a second conflict is returned without a third attempt", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv, {
    put: async () => {
      throw new StatusError(409, "conflict");
    }
  });
  await h.saver.fetch();
  await assert.rejects(h.saver.saveWhole((data) => ({ ...data, name: "Local" })), (error) => error instanceof StatusError && error.status === 409);
  assert.equal(h.puts.length, 2);
});

test("a whole save whose updater changes nothing sends nothing and resolves to the copy", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv);
  const loaded = await h.saver.fetch();
  const writes = h.writes.length;
  const saved = await h.saver.saveWhole((data) => data);
  assert.equal(h.puts.length, 0);
  assert.equal(saved.updatedAt, loaded!.updatedAt);
  assert.equal(h.writes.length, writes);
});

test("an optimistic whole save shows at once, is uploaded from the confirmed copy, and leaves once its echo lands", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const gate = deferred();
  const h = harness(srv, {
    put: async (data, expected) => {
      await gate.promise;
      return srv.put(data, expected);
    }
  });
  await h.saver.fetch();
  const reverse = (data: LibraryData) => ({ ...data, books: [...data.books].reverse() });

  const saving = h.saver.saveWhole(reverse, { optimistic: true });
  assert.deepEqual(titles(h.last()!.data), ["Emma", "Dune"]);
  assert.equal(h.saver.hasPending(), true);
  await flush();
  assert.deepEqual(titles(h.puts[0]!.data), ["Emma", "Dune"]);

  gate.resolve();
  await saving;
  assert.deepEqual(titles(srv.doc!.data), ["Emma", "Dune"]);
  assert.deepEqual(titles(h.last()!.data), ["Emma", "Dune"]);
  assert.equal(h.last()!.updatedAt, srv.doc!.updatedAt);
  assert.equal(h.saver.hasPending(), false);
});

test("a failed optimistic whole save moves back and refetches", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv, {
    put: async () => {
      throw new StatusError(500);
    }
  });
  await h.saver.fetch();
  const saving = h.saver.saveWhole((data) => ({ ...data, books: [...data.books].reverse() }), { optimistic: true });
  assert.deepEqual(titles(h.last()!.data), ["Emma", "Dune"]);
  await assert.rejects(saving);
  assert.deepEqual(titles(h.last()!.data), ["Dune", "Emma"]);
  assert.equal(h.saver.hasPending(), false);
  await flush();
  assert.equal(h.fetches.count, 2);
});

test("a new tap is applied to the current view; earlier pending changes run again only when the copy is replaced or a change fails", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const sendGate = deferred();
  const refreshGate = deferred<LibraryDocument | null>();
  let sends = 0;
  let fetches = 0;
  let reorders = 0;
  const h = harness(srv, {
    send: async (change) => {
      await sendGate.promise;
      if (sends++ === 0) throw new StatusError(500);
      return srv.send(change);
    },
    fetch: () => (fetches++ === 0 ? Promise.resolve(srv.doc) : refreshGate.promise)
  });
  await h.saver.fetch();

  const failing = h.saver.submit(tick(duneKey));
  const saving = h.saver.saveWhole(
    (data) => {
      reorders++;
      return { ...data, books: [...data.books].reverse() };
    },
    { optimistic: true }
  );
  assert.equal(reorders, 1);
  const later = h.saver.submit(tick(emmaKey));
  assert.equal(reorders, 1);
  assert.deepEqual(keysOf(h.last()), [duneKey, emmaKey]);

  h.saver.receive(srv.commit({ ...srv.doc!.data, name: "Renamed on the phone" }));
  assert.equal(reorders, 2);

  sendGate.resolve();
  assert.equal((await failing).ok, false);
  assert.equal(reorders, 3);
  assert.deepEqual(keysOf(h.last()), [emmaKey]);
  assert.deepEqual(titles(h.last()!.data), ["Emma", "Dune"]);

  refreshGate.resolve(srv.doc);
  await saving;
  assert.equal((await later).ok, true);
  assert.deepEqual(titles(srv.doc!.data), ["Emma", "Dune"]);
  assert.deepEqual(keysOf(srv.doc), [emmaKey]);
});

test("a merge is a queued job that gets the copy's version and goes through receive", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv);
  await h.saver.fetch();

  const merged = await h.saver.merge(async (expected) => srv.put({ ...srv.doc!.data, name: "Merged" }, expected));
  assert.equal(merged.updatedAt, version(2));
  assert.equal(h.last()!.data.name, "Merged");
  assert.equal(h.last()!.updatedAt, version(2));

  await h.saver.submit(tick(duneKey));
  assert.equal(h.last()!.updatedAt, version(3));
  assert.equal(h.fetches.count, 1);
});

test("a merge that fails is rejected and the jobs behind it still run", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv);
  await h.saver.fetch();
  const failure = new StatusError(409, "The library changed elsewhere.");
  const merging = h.saver.merge(async () => {
    throw failure;
  });
  const ticking = h.saver.submit(tick(duneKey));
  await assert.rejects(merging, (error) => error === failure);
  assert.equal((await ticking).ok, true);
});

test("a change that gets no answer is aborted after 30 s and treated as a failure, and the next change still runs", { timeout: 5000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const srv = server(shelf());
  const signals: AbortSignal[] = [];
  const h = harness(srv, {
    send: (change, signal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<LibraryChangeAnswer>(() => {}) : Promise.resolve(srv.send(change));
    }
  });
  await h.saver.fetch();

  const first = h.saver.submit(tick(duneKey));
  const second = h.saver.submit(tick(emmaKey));
  let firstAnswered = false;
  void first.then(() => {
    firstAnswered = true;
  });
  t.mock.timers.tick(29_999);
  await flush();
  assert.equal(firstAnswered, false);
  assert.equal(signals[0]!.aborted, false);
  assert.equal(signals.length, 1);

  t.mock.timers.tick(1);
  await flush();
  assert.equal((await first).ok, false);
  assert.equal(signals[0]!.aborted, true);
  assert.equal((await second).ok, true);
  assert.deepEqual(keysOf(h.last()), [emmaKey]);
  assert.deepEqual(keysOf(srv.doc), [emmaKey]);
});

test("a whole save that gets no answer is aborted after 60 s and rejected, and the next job still runs", { timeout: 5000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const srv = server(shelf());
  const signals: AbortSignal[] = [];
  const h = harness(srv, {
    put: (data, expected, _source, signal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<LibraryDocument>(() => {}) : Promise.resolve(srv.put(data, expected));
    }
  });
  await h.saver.fetch();

  const saving = h.saver.saveWhole((data) => ({ ...data, name: "Renamed" }));
  const rejected = assert.rejects(saving, /did not answer/);
  const ticking = h.saver.submit(tick(duneKey));
  t.mock.timers.tick(59_999);
  await flush();
  assert.equal(signals[0]!.aborted, false);
  assert.equal(h.sent.length, 0);

  t.mock.timers.tick(1);
  await flush();
  await rejected;
  assert.equal(signals[0]!.aborted, true);
  assert.equal((await ticking).ok, true);
  assert.deepEqual(keysOf(srv.doc), [duneKey]);
});

test("dispose drops the jobs not yet sent and stops the one running: nothing is sent, fetched or written afterwards", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const gate = deferred();
  const h = harness(srv, {
    send: async (change) => {
      await gate.promise;
      return srv.send(change);
    }
  });
  await h.saver.fetch();
  const running = h.saver.submit(tick(duneKey));
  const queued = h.saver.submit(tick(emmaKey));
  const saving = h.saver.saveWhole((data) => ({ ...data, name: "Renamed" }));
  const savingRejected = assert.rejects(saving);
  const merging = h.saver.merge(async () => srv.doc!);
  const mergeRejected = assert.rejects(merging);
  await flush();
  assert.equal(h.sent.length, 1);

  h.saver.dispose();
  const writes = h.writes.length;
  const fetches = h.fetches.count;
  assert.equal(h.saver.hasPending(), false);

  assert.deepEqual([(await running).ok, (await queued).ok], [false, false]);
  await savingRejected;
  await mergeRejected;
  gate.resolve();
  await flush();
  assert.equal(h.sent.length, 1);
  assert.equal(h.puts.length, 0);
  assert.equal(h.writes.length, writes);
  assert.equal(h.fetches.count, fetches);
});

test("dispose during a 409 replay sends nothing more", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const replayFetch = deferred<LibraryDocument | null>();
  let fetches = 0;
  const h = harness(srv, { fetch: () => (fetches++ === 0 ? Promise.resolve(srv.doc) : replayFetch.promise) });
  await h.saver.fetch();
  srv.commit({ ...srv.doc!.data, name: "Renamed on the phone" });

  const saving = h.saver.saveWhole((data) => ({ ...data, name: "Mine" }));
  const rejected = assert.rejects(saving);
  await flush();
  assert.equal(h.puts.length, 1);
  assert.equal(fetches, 2);

  h.saver.dispose();
  const writes = h.writes.length;
  replayFetch.resolve(srv.doc);
  await rejected;
  await flush();
  assert.equal(h.puts.length, 1);
  assert.equal(h.writes.length, writes);
  assert.equal(srv.doc!.data.name, "Renamed on the phone");
});

test("dispose between the replay's fetch answering and the resend sends nothing more", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  let fetches = 0;
  const h = harness(srv, {
    fetch: () => {
      if (fetches++ === 0) return Promise.resolve(srv.doc);
      const answered = Promise.resolve(srv.doc);
      void answered.then(() => h.saver.dispose());
      return answered;
    }
  });
  await h.saver.fetch();
  srv.commit({ ...srv.doc!.data, name: "Renamed on the phone" });

  const saving = h.saver.saveWhole((data) => ({ ...data, name: "Mine" }));
  await assert.rejects(saving);
  await flush();
  assert.equal(h.puts.length, 1);
  assert.equal(srv.doc!.data.name, "Renamed on the phone");
});

test("dispose while an answer is being waited on writes nothing when it arrives", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const gate = deferred();
  const h = harness(srv, {
    send: async (change) => {
      await gate.promise;
      return srv.send(change);
    }
  });
  await h.saver.fetch();
  const ticking = h.saver.submit(tick(duneKey));
  await flush();
  h.saver.dispose();
  const writes = h.writes.length;
  gate.resolve();
  assert.equal((await ticking).ok, false);
  await flush();
  assert.equal(h.writes.length, writes);
  assert.equal(h.fetches.count, 1);
});

test("after dispose every call settles at once and nothing is sent, fetched or written", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv);
  await h.saver.fetch();
  h.saver.dispose();
  h.saver.dispose();
  const writes = h.writes.length;
  const fetches = h.fetches.count;

  assert.equal((await h.saver.submit(tick(duneKey))).ok, false);
  await assert.rejects(h.saver.saveWhole((data) => data));
  await assert.rejects(h.saver.merge(async () => srv.doc!));
  h.saver.receive(srv.commit({ ...srv.doc!.data, name: "Renamed on the phone" }));
  h.saver.receiveShare({ ...srv.doc!, shareToken: "t1", shareUrl: "https://atmyshelf.test/t1" });
  assert.equal((await h.saver.fetch())!.data.name, "Mine");

  assert.equal(h.sent.length, 0);
  assert.equal(h.puts.length, 0);
  assert.equal(h.writes.length, writes);
  assert.equal(h.fetches.count, fetches);
  assert.equal(h.saver.hasPending(), false);
});

test("the query function resolves to the view, never to the fetched document", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const stale = srv.doc!;
  srv.commit({ ...stale.data, name: "Renamed on the phone" });
  const gate = deferred();
  let answer: LibraryDocument | null = srv.doc;
  const h = harness(srv, {
    send: async (change) => {
      await gate.promise;
      return srv.send(change);
    },
    fetch: async () => answer
  });
  await h.saver.fetch();
  const ticking = h.saver.submit(tick(duneKey));

  answer = stale;
  const view = await h.saver.fetch();
  assert.equal(view, h.last());
  assert.deepEqual(keysOf(view), [duneKey]);
  assert.equal(view!.data.name, "Renamed on the phone");
  assert.equal(view!.updatedAt, version(2));

  gate.resolve();
  await ticking;
});

test("a change answered after a document that already holds it landed leaves pending at once", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const answerGate = deferred();
  const h = harness(srv, {
    send: async (change) => {
      const answer = srv.send(change);
      await answerGate.promise;
      return answer;
    }
  });
  await h.saver.fetch();
  const ticking = h.saver.submit(tick(duneKey));
  await flush();
  h.saver.receive(srv.doc!);
  assert.equal(h.saver.hasPending(), true);

  answerGate.resolve();
  assert.equal((await ticking).ok, true);
  assert.equal(h.saver.hasPending(), false);
  assert.deepEqual(keysOf(h.last()), [duneKey]);
  assert.equal(h.last()!.updatedAt, version(2));
});

test("a change that alters nothing on the server leaves the copy at its version", { timeout: 5000 }, async () => {
  const srv = server({ ...shelf(), groups: [{ ...shelf().groups![0]!, bookKeys: [duneKey] }] });
  const h = harness(srv);
  await h.saver.fetch();

  assert.equal((await h.saver.submit(tick(duneKey))).ok, true);
  assert.equal(srv.doc!.updatedAt, version(1));
  assert.equal(h.last()!.updatedAt, version(1));
  assert.equal(h.saver.hasPending(), false);
  assert.equal(h.fetches.count, 1);

  await h.saver.saveWhole((data) => ({ ...data, name: "Renamed" }));
  assert.deepEqual(h.puts.map((put) => put.expected), [version(1)]);
});

test("a change the copy cannot apply is not folded: the copy keeps its version and fetches", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv, { send: async () => ({ updatedAt: version(2), baseUpdatedAt: version(1) }) });
  await h.saver.fetch();

  assert.equal((await h.saver.submit({ kind: "membership", groupId: "gone", bookKey: duneKey, member: true })).ok, true);
  await flush();
  assert.equal(h.last()!.updatedAt, version(1));
  assert.equal(h.saver.hasPending(), false);
  assert.equal(h.fetches.count, 2);

  await h.saver.saveWhole((data) => ({ ...data, name: "Renamed" }));
  assert.equal(h.puts[0]!.expected, version(1));
});

test("a failed change hands the caller the server's error, so a 429 is not shown as a lost connection", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const failure = new StatusError(429, "Too Many Requests");
  const h = harness(srv, {
    send: async () => {
      throw failure;
    }
  });
  await h.saver.fetch();
  const result = await h.saver.submit(tick(duneKey));
  assert.deepEqual(result, { ok: false, error: failure });
  assert.equal(saveFailureMessage((result as { error: unknown }).error, "Couldn't save."), "Too many changes in a row — wait a minute and try again.");
});

test("a change dropped, interrupted or refused by dispose reports that the library was closed", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const gate = deferred();
  const h = harness(srv, {
    send: async (change) => {
      await gate.promise;
      return srv.send(change);
    }
  });
  await h.saver.fetch();
  const running = h.saver.submit(tick(duneKey));
  const queued = h.saver.submit(tick(emmaKey));
  await flush();
  h.saver.dispose();
  for (const result of [await running, await queued, await h.saver.submit(tick(duneKey))]) {
    assert.equal(result.ok, false);
    assert.match(String((result as { error: unknown }).error), /closed/);
  }
});

test("a change is resolved when the server answers, not after the follow-up fetch", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const never = new Promise<LibraryDocument | null>(() => {});
  let fetches = 0;
  const h = harness(srv, { fetch: () => (fetches++ === 0 ? Promise.resolve(srv.doc) : never) });
  await h.saver.fetch();
  assert.deepEqual(await h.saver.submit({ kind: "add", book: { Title: "Neuromancer", Attribution: "William Gibson" } }), { ok: true });
});

test("hasPending ignores a change the server already saved", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv, { send: async () => ({ updatedAt: version(9), baseUpdatedAt: version(1) }) });
  await h.saver.fetch();
  const ticking = h.saver.submit(tick(duneKey));
  assert.equal(h.saver.hasPending(), true);
  await ticking;
  assert.equal(h.saver.hasPending(), false);
  assert.deepEqual(keysOf(h.last()), [duneKey]);
});

function throwingWriteSaver(srv: Server, failOn: (call: number) => boolean) {
  let calls = 0;
  const boom = new Error("write failed");
  const writes: Array<LibraryDocument | null> = [];
  const saver = createLibrarySaver({
    send: async (change) => srv.send(change),
    put: async (data, expected) => srv.put(data, expected),
    fetch: async () => srv.doc,
    write: (view) => {
      if (failOn(++calls)) throw boom;
      writes.push(view);
    }
  });
  return { saver, boom, writes };
}

test("an exception inside a change does not strand the queue behind it", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = throwingWriteSaver(srv, (call) => call === 4);
  await h.saver.fetch();
  const first = h.saver.submit(tick(duneKey));
  const second = h.saver.submit(tick(emmaKey));
  assert.deepEqual(await first, { ok: false, error: h.boom });
  assert.deepEqual(await second, { ok: true });
  assert.deepEqual(keysOf(srv.doc), [duneKey, emmaKey]);
  assert.equal(h.saver.hasPending(), false);
});

test("an exception while a change is first shown is returned, not thrown, and nothing is sent", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = throwingWriteSaver(srv, (call) => call === 2);
  await h.saver.fetch();
  assert.deepEqual(await h.saver.submit(tick(duneKey)), { ok: false, error: h.boom });
  assert.equal(h.saver.hasPending(), false);
  assert.deepEqual(keysOf(srv.doc), []);
  assert.deepEqual(await h.saver.submit(tick(duneKey)), { ok: true });
});

test("an exception inside a merge rejects it and the jobs behind it still run", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = throwingWriteSaver(srv, (call) => call === 3);
  await h.saver.fetch();
  const merging = assert.rejects(h.saver.merge(async (expected) => srv.put({ ...srv.doc!.data, name: "Merged" }, expected)), h.boom);
  const ticking = h.saver.submit(tick(duneKey));
  await merging;
  assert.deepEqual(await ticking, { ok: true });
});

test("an exception inside a whole save rejects it and the jobs behind it still run", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = throwingWriteSaver(srv, (call) => call === 3);
  await h.saver.fetch();
  const saving = assert.rejects(h.saver.saveWhole((data) => ({ ...data, name: "Renamed" })), h.boom);
  const ticking = h.saver.submit(tick(duneKey));
  await saving;
  assert.deepEqual(await ticking, { ok: true });
});

test("the refresh after a failed change is aborted after 10 s, and the next change runs then", { timeout: 5000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const srv = server(shelf());
  const signals: Array<AbortSignal | undefined> = [];
  let fetches = 0;
  let sends = 0;
  const h = harness(srv, {
    send: async (change) => {
      if (sends++ === 0) throw new StatusError(500);
      return srv.send(change);
    },
    fetch: (signal) => {
      if (fetches++ === 0) return Promise.resolve(srv.doc);
      signals.push(signal);
      return new Promise<LibraryDocument | null>(() => {});
    }
  });
  await h.saver.fetch();
  const failing = h.saver.submit(tick(duneKey));
  const next = h.saver.submit(tick(emmaKey));
  assert.equal((await failing).ok, false);
  await flush();
  t.mock.timers.tick(9_999);
  await flush();
  assert.equal(signals[0]!.aborted, false);
  assert.equal(h.sent.length, 1);

  t.mock.timers.tick(1);
  assert.equal((await next).ok, true);
  assert.equal(signals[0]!.aborted, true);
});

test("the fetch inside a 409 replay is aborted after 60 s and the save rejected", { timeout: 5000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const srv = server(shelf());
  const signals: Array<AbortSignal | undefined> = [];
  let fetches = 0;
  const h = harness(srv, {
    fetch: (signal) => {
      if (fetches++ === 0) return Promise.resolve(srv.doc);
      signals.push(signal);
      return new Promise<LibraryDocument | null>(() => {});
    }
  });
  await h.saver.fetch();
  srv.commit({ ...srv.doc!.data, name: "Renamed on the phone" });
  const saving = assert.rejects(h.saver.saveWhole((data) => ({ ...data, name: "Mine" })), /did not answer/);
  await flush();
  t.mock.timers.tick(59_999);
  await flush();
  assert.equal(signals[0]!.aborted, false);
  t.mock.timers.tick(1);
  await saving;
  assert.equal(signals[0]!.aborted, true);
  assert.equal(h.puts.length, 1);
});

test("a merge request that gets no answer is aborted after 60 s and rejected, and the next job still runs", { timeout: 5000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const srv = server(shelf());
  const h = harness(srv);
  await h.saver.fetch();
  let signal: AbortSignal | undefined;
  const merging = assert.rejects(
    h.saver.merge((_expected, requestSignal) => {
      signal = requestSignal;
      return new Promise<LibraryDocument>(() => {});
    }),
    /did not answer/
  );
  const ticking = h.saver.submit(tick(duneKey));
  await flush();
  t.mock.timers.tick(59_999);
  await flush();
  assert.equal(signal!.aborted, false);
  assert.equal(h.sent.length, 0);
  t.mock.timers.tick(1);
  await merging;
  assert.equal(signal!.aborted, true);
  assert.equal((await ticking).ok, true);
});

test("dispose landing between a 409 and its handler neither refetches nor resends", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const conflict = deferred<LibraryDocument>();
  const h = harness(srv, { put: () => conflict.promise });
  await h.saver.fetch();
  const saving = assert.rejects(h.saver.saveWhole((data) => ({ ...data, name: "Mine" })), (error) => error instanceof StatusError && error.status === 409);
  await flush();
  assert.equal(h.puts.length, 1);
  conflict.reject(new StatusError(409));
  h.saver.dispose();
  await saving;
  await flush();
  assert.equal(h.puts.length, 1);
  assert.equal(h.fetches.count, 1);
});

test("a share response that changes only the url replaces the url and keeps the token", { timeout: 5000 }, async () => {
  const srv = server(shelf());
  const h = harness(srv);
  const loaded = (await h.saver.fetch())!;
  h.saver.receiveShare({ ...loaded, shareToken: "t1", shareUrl: "https://atmyshelf.test/t1" });
  const before = h.writes.length;
  h.saver.receiveShare({ ...loaded, shareToken: "t1", shareUrl: "https://shelf.example/t1" });
  assert.equal(h.writes.length, before + 1);
  assert.equal(h.last()!.shareToken, "t1");
  assert.equal(h.last()!.shareUrl, "https://shelf.example/t1");
});
