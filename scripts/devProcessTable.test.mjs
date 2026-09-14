import assert from "node:assert/strict";
import { test } from "node:test";
import { childrenByPpid, parseProcessTable, subtreePids, sumSubtree } from "./devProcessTable.mjs";

const TABLE = [
  "  PID  PPID    RSS  %CPU COMM",
  "  100     1  10240   4.0 /usr/local/bin/node",
  "  101   100  20480   2.5 /usr/local/bin/node",
  "  102   101  30720   1.5 /usr/local/bin/node",
  "  103   100  40960   0.0 /Applications/Some App.app/Contents/MacOS/Some App",
  "  200     1   1024   0.5 /usr/sbin/unrelated",
].join("\n");

test("parseProcessTable skips the header and reads every column", () => {
  const rows = parseProcessTable(TABLE);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { pid: 100, ppid: 1, rss: 10240, cpu: 4, comm: "/usr/local/bin/node" });
});

test("parseProcessTable keeps a comm containing spaces intact", () => {
  const row = parseProcessTable(TABLE).find((r) => r.pid === 103);
  assert.equal(row.comm, "/Applications/Some App.app/Contents/MacOS/Some App");
});

test("a comma-decimal CPU is rejected loudly, never read as zero", () => {
  const localised = "  100     1  10240   4,0 /usr/local/bin/node";
  assert.throws(() => parseProcessTable(localised), /LC_ALL=C/);
});

test("sumSubtree sums a recorded pid with all of its descendants", () => {
  const { rssKB, cpu, pids } = sumSubtree(100, parseProcessTable(TABLE));
  assert.equal(rssKB, 10240 + 20480 + 30720 + 40960);
  assert.equal(cpu, 8);
  assert.deepEqual(pids.sort((a, b) => a - b), [100, 101, 102, 103]);
});

test("sumSubtree of a leaf is just that process", () => {
  assert.deepEqual(sumSubtree(200, parseProcessTable(TABLE)).pids, [200]);
});

test("sumSubtree of an unknown pid reports zero, not a throw", () => {
  assert.deepEqual(sumSubtree(999, parseProcessTable(TABLE)), { rssKB: 0, cpu: 0, pids: [] });
});

test("subtreePids survives a ppid cycle instead of looping forever", () => {
  const rows = [
    { pid: 1, ppid: 2, rss: 1, cpu: 0, comm: "a" },
    { pid: 2, ppid: 1, rss: 1, cpu: 0, comm: "b" },
  ];
  assert.deepEqual(subtreePids(1, childrenByPpid(rows)).sort(), [1, 2]);
});
