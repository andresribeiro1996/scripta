import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { startServer } from "./dev-status-server.mjs";

test("a port already in use produces a plain message, not a thrown stack trace", async () => {
  // Bound to 0.0.0.0, not 127.0.0.1: startServer itself binds 0.0.0.0, and
  // on this platform a 0.0.0.0 listen does NOT collide with an already-
  // bound 127.0.0.1 socket on the same port (verified — it silently
  // succeeds, so the test would hang forever waiting for an error that
  // never fires). Matching the real bind address is what actually
  // reproduces EADDRINUSE.
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, "0.0.0.0", resolve));
  const port = occupied.address().port;

  const messages = [];
  const originalExitCode = process.exitCode;

  await new Promise((resolve) => {
    startServer({
      repoRoot: process.cwd(),
      port,
      onError: (message) => {
        messages.push(message);
        resolve();
      },
    });
  });

  assert.equal(messages.length, 1);
  assert.ok(!messages[0].includes("\n"), "message must be a single plain sentence, not a multi-line stack trace");
  assert.ok(!messages[0].includes(" at "), "message must not carry a stack frame");
  assert.match(messages[0], /already in use/i);
  assert.match(messages[0], new RegExp(String(port)));
  assert.equal(process.exitCode, 1);

  process.exitCode = originalExitCode;
  await new Promise((resolve) => occupied.close(resolve));
});
