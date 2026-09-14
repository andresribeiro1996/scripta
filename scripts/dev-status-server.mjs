// The same collectStatus() the CLI prints, rendered for a phone. Bound to
// 7070 — outside every slot range (backend 3000–4500, Vite 5173–6673,
// Metro 8081–9581), so it can never collide with a worktree's stack. It
// holds no slot and is not part of any worktree's stack: started and
// stopped by hand. Sampled per request; nothing is polled or stored.

import { createServer } from "node:http";
import { collectStatus } from "./devStatus.mjs";
import { renderPage } from "./devStatusPage.mjs";
import { pickLanAddress } from "./lanAddress.mjs";

export const STATUS_PAGE_PORT = 7070;

export function startServer({ repoRoot, port = STATUS_PAGE_PORT } = {}) {
  const server = createServer((request, response) => {
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    try {
      const status = collectStatus({ repoRoot });
      const body = request.url === "/status.json" ? JSON.stringify(status, null, 2) : renderPage(status);
      const type = request.url === "/status.json" ? "application/json" : "text/html; charset=utf-8";
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(String(error?.stack ?? error));
    }
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[dev-status] http://${pickLanAddress() ?? "localhost"}:${port} — Ctrl-C to stop.`);
  });
  return server;
}
