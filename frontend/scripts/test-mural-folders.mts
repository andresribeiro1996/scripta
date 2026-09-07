import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTree, collectSubtreeIds, folderPath } from "../src/lib/muralFolders.ts";
import type { MuralFolder } from "../src/lib/murals.ts";

function folder(id: string, parentId: string | null): MuralFolder {
  return { id, name: id, parentId, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
}

const root1 = folder("root1", null);
const root2 = folder("root2", null);
const child1 = folder("child1", "root1");
const grandchild = folder("grandchild", "child1");
const childOf2 = folder("childOf2", "root2");
const folders = [root1, root2, child1, grandchild, childOf2];

test("buildTree walks depth-first from roots, tracking depth", () => {
  const nodes = buildTree(folders);
  assert.deepEqual(
    nodes.map((n) => [n.folder.id, n.depth]),
    [["root1", 0], ["child1", 1], ["grandchild", 2], ["root2", 0], ["childOf2", 1]],
  );
});

test("folderPath returns the ancestor chain root-first", () => {
  assert.deepEqual(folderPath(folders, "grandchild").map((f) => f.id), ["root1", "child1", "grandchild"]);
  assert.deepEqual(folderPath(folders, "root1").map((f) => f.id), ["root1"]);
  assert.deepEqual(folderPath(folders, null), []);
  assert.deepEqual(folderPath(folders, "missing"), []);
});

test("collectSubtreeIds closes transitively and includes the id itself", () => {
  assert.deepEqual([...collectSubtreeIds(folders, "root1")].sort(), ["child1", "grandchild", "root1"]);
  assert.deepEqual([...collectSubtreeIds(folders, "grandchild")], ["grandchild"]);
  assert.deepEqual([...collectSubtreeIds(folders, "root2")], ["root2", "childOf2"]);
});
