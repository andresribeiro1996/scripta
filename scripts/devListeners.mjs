import { execFileSync } from "node:child_process";

// -Fpn emits one p<pid> line followed by the f<fd>/n<name> lines for that
// pid, so the current pid has to be carried down the loop. Names come in
// three shapes — "*:3100", "127.0.0.1:5273" and "[::1]:5273" — and the
// port is the tail of all three, which is why this splits on the LAST
// colon rather than parsing the address.
export function parseListeners(output) {
  const byPort = {};
  let pid;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
      continue;
    }
    if (!line.startsWith("n") || pid === undefined) continue;
    const port = Number(line.slice(line.lastIndexOf(":") + 1));
    if (!Number.isInteger(port)) continue;
    const pids = (byPort[port] ??= []);
    if (!pids.includes(pid)) pids.push(pid);
  }
  return byPort;
}

export function readListeners(exec = execFileSync) {
  try {
    return parseListeners(exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], { encoding: "utf8" }));
  } catch (error) {
    // lsof exits 1 with empty output when nothing is listening at all —
    // the normal empty case, not a failure. A missing lsof lands here
    // too, and this tool must degrade rather than abort.
    if (error.status === 1) return {};
    return {};
  }
}
