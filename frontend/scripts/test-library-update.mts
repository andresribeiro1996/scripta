import assert from "node:assert/strict";
import { test } from "node:test";
import { saveFailureMessage } from "@scripta/shared";
import type { LibraryData, LibraryDocument } from "../src/api/library";
import { saveLibraryUpdate } from "../src/lib/saveLibraryUpdate";
import { restoreDeletedBooks } from "../src/lib/restoreDeletedBooks";

function document(data: LibraryData, updatedAt: string): LibraryDocument {
  return { data, updatedAt, shareToken: null, shareUrl: null };
}

test("stale library updates refetch and reapply once", async () => {
  const stale = document({ books: [], name: "Old" }, "v1");
  const fresh = document({ books: [{ Title: "Remote" }], name: "Old" }, "v2");
  const saves: Array<{ data: LibraryData; updatedAt?: string }> = [];
  const saved = await saveLibraryUpdate(
    stale,
    (data) => ({ ...data, name: "Local" }),
    async () => fresh,
    async (data, updatedAt) => {
      saves.push({ data, updatedAt });
      if (saves.length === 1) throw Object.assign(new Error("conflict"), { status: 409 });
      return document(data, "v3");
    },
  );

  assert.equal(saves.length, 2);
  assert.equal(saves[1]?.updatedAt, "v2");
  assert.equal(saved.data.name, "Local");
  assert.equal(saved.data.books[0]?.Title, "Remote");
});

test("non-conflict errors are not retried", async () => {
  let fetched = false;
  await assert.rejects(
    saveLibraryUpdate(
      document({ books: [] }, "v1"),
      (data) => ({ ...data, name: "Local" }),
      async () => {
        fetched = true;
        return null;
      },
      async () => {
        throw { status: 500 };
      },
    ),
  );
  assert.equal(fetched, false);
});

test("an oversized library reaches the caller with the server's message and is not retried", async () => {
  const message = "Your library is over 10 MB, the most Scripta can store. Remove some books or highlights and try again.";
  let fetched = false;
  const error = await saveLibraryUpdate(
    document({ books: [] }, "v1"),
    (data) => ({ ...data, name: "Local" }),
    async () => {
      fetched = true;
      return null;
    },
    async () => {
      throw Object.assign(new Error(message), { status: 413 });
    },
  ).catch((reason: unknown) => reason);

  assert.equal(saveFailureMessage(error, "Couldn't save the new name."), message);
  assert.equal(fetched, false);
});

test("a cold cache cannot replace an existing remote library", async () => {
  const fresh = document({ books: [{ Title: "Remote" }] }, "v2");
  let saves = 0;
  const saved = await saveLibraryUpdate(
    undefined,
    (data) => ({ ...data, name: "Local" }),
    async () => fresh,
    async (data) => {
      saves += 1;
      if (saves === 1) throw Object.assign(new Error("conflict"), { status: 409 });
      return document(data, "v3");
    },
  );

  assert.equal(saves, 2);
  assert.equal(saved.data.books[0]?.Title, "Remote");
});

test("a second conflict is returned without a third attempt", async () => {
  let saves = 0;
  await assert.rejects(saveLibraryUpdate(
    document({ books: [] }, "v1"),
    (data) => ({ ...data, name: "Local" }),
    async () => document({ books: [] }, "v2"),
    async () => {
      saves += 1;
      throw Object.assign(new Error("conflict"), { status: 409 });
    },
  ));
  assert.equal(saves, 2);
});

test("undo restores deleted books without replacing concurrent changes", () => {
  const snapshot: LibraryData = {
    books: [{ Title: "Deleted" }, { Title: "Kept" }],
    groups: [{ id: "group", type: "collection", name: "Before", bookKeys: ["ta:deleted|", "ta:kept|"], createdAt: "t", updatedAt: "t" }],
  };
  const current: LibraryData = {
    books: [{ Title: "Kept" }, { Title: "Remote" }],
    groups: [{ ...snapshot.groups![0]!, name: "Remote rename", bookKeys: ["ta:kept|"] }],
  };
  const restored = restoreDeletedBooks(current, snapshot, new Set(["ta:deleted|"]));

  assert.deepEqual(restored.books.map((book) => book.Title), ["Deleted", "Kept", "Remote"]);
  assert.equal(restored.groups?.[0]?.name, "Remote rename");
  assert.deepEqual(restored.groups?.[0]?.bookKeys, ["ta:deleted|", "ta:kept|"]);
  assert.notEqual(restored.groups?.[0]?.updatedAt, "t");
});

test("undo preserves duplicate book keys", () => {
  const duplicate = { Title: "Duplicate", Attribution: "Author" };
  const snapshot: LibraryData = { books: [duplicate, { ...duplicate }, { Title: "Deleted" }, { Title: "Kept" }] };
  const current: LibraryData = { books: [duplicate, { ...duplicate }, { Title: "Kept" }] };
  const restored = restoreDeletedBooks(current, snapshot, new Set(["ta:deleted|"]));

  assert.deepEqual(restored.books.map((book) => book.Title), ["Duplicate", "Duplicate", "Deleted", "Kept"]);
});
