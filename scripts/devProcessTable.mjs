import { execFileSync } from "node:child_process";

// Four numeric columns then the rest of the line, because `comm` on macOS
// is a full binary path and routinely contains spaces
// ("/Applications/Some App.app/..."). Splitting on whitespace throughout
// would truncate it.
const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/;

export function parseProcessTable(output) {
  const rows = [];
  for (const line of output.split("\n")) {
    const match = ROW.exec(line);
    if (!match) continue;
    const [, pid, ppid, rss, cpu, comm] = match;
    // Verified on this machine: `ps -o pcpu` prints "0,1" under the
    // user's locale and "0.1" under LC_ALL=C. parseFloat("0,1") is 0, so
    // a silent read would report every stack as idle and the tool would
    // look like it works. Loud is the only safe failure here.
    if (cpu.includes(",")) {
      throw new Error(
        `ps reported CPU as "${cpu}" — a comma decimal. Every ps call must set LC_ALL=C (see scripts/devProcessTable.mjs).`,
      );
    }
    if (!/^\d+(?:\.\d+)?$/.test(cpu)) continue;
    rows.push({ pid: Number(pid), ppid: Number(ppid), rss: Number(rss), cpu: Number(cpu), comm });
  }
  return rows;
}

export function readProcessTable(exec = execFileSync) {
  const output = exec("ps", ["-A", "-o", "pid,ppid,rss,pcpu,comm"], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseProcessTable(output);
}

export function childrenByPpid(rows) {
  const index = new Map();
  for (const row of rows) {
    const siblings = index.get(row.ppid) ?? [];
    siblings.push(row.pid);
    index.set(row.ppid, siblings);
  }
  return index;
}

export function subtreePids(rootPid, childIndex) {
  const seen = new Set();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of childIndex.get(pid) ?? []) queue.push(child);
  }
  return [...seen];
}

export function indexProcessTable(rows) {
  return { byPid: new Map(rows.map((row) => [row.pid, row])), childIndex: childrenByPpid(rows) };
}

// `index` is optional and defaults to building both maps here, so the
// two-argument call sites (devDevices.mjs) are unchanged. Callers that
// sum many roots over one `ps` table pass a hoisted index instead, which
// is the difference between one index build and one per root.
export function sumSubtree(rootPid, rows, index = indexProcessTable(rows)) {
  const { byPid, childIndex } = index;
  if (!byPid.has(rootPid)) return { rssKB: 0, cpu: 0, pids: [] };
  const pids = subtreePids(rootPid, childIndex).filter((pid) => byPid.has(pid));
  return {
    rssKB: pids.reduce((total, pid) => total + byPid.get(pid).rss, 0),
    cpu: Number(pids.reduce((total, pid) => total + byPid.get(pid).cpu, 0).toFixed(1)),
    pids,
  };
}
