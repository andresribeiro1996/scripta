import assert from "node:assert/strict";
import { test } from "node:test";
import { entranceAvailable, markEntrancePlayed } from "./markEntrance";

test("the entrance is available until the first mark has mounted, then never again this launch", () => {
  assert.equal(entranceAvailable(), true);
  assert.equal(entranceAvailable(), true);
  markEntrancePlayed();
  assert.equal(entranceAvailable(), false);
  markEntrancePlayed();
  assert.equal(entranceAvailable(), false);
});
