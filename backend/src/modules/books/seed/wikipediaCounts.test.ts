import assert from "node:assert/strict";
import { test } from "node:test";
import { wikipediaSitesFrom } from "./wikipediaCounts.js";

test("wikipediaSitesFrom keeps the highest count per key and skips malformed rows", () => {
  const rows = wikipediaSitesFrom([
    { id: { value: "OL1W" }, n: { value: "40" } },
    { id: { value: "OL1W" }, n: { value: "55" } },
    { id: { value: "OL2W" }, n: { value: "0" } },
    { id: { value: "OL3W" }, n: { value: "many" } },
    { n: { value: "7" } }
  ]);
  assert.deepEqual(rows, [{ olWorkKey: "OL1W", sites: 55 }, { olWorkKey: "OL2W", sites: 0 }]);
});
