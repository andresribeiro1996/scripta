import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { WebSocketServer } from "ws";
import { broadcastReload } from "./devReload.mjs";

// Stands in for Metro's own /message websocket — the endpoint `expo start`
// broadcasts on when you press `r`, verified to accept an upgrade on a
// running dev server. The test asserts the frame a real Expo Go client
// would act on, not that some function was called.
async function startMessageServer() {
  const received = [];
  const http = createServer();
  const sockets = new WebSocketServer({ server: http, path: "/message" });
  sockets.on("connection", (socket) => {
    socket.on("message", (data) => received.push(String(data)));
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  // The server observes the frame on its own tick, so a bare assert right
  // after broadcastReload resolves races delivery rather than testing it.
  const waitForMessage = async () => {
    for (let i = 0; i < 100 && received.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
    return received;
  };
  return { port: http.address().port, waitForMessage, close: () => new Promise((resolve) => http.close(resolve)) };
}

const closedPort = await (async () => {
  const http = createServer();
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address();
  await new Promise((resolve) => http.close(resolve));
  return port;
})();

test("broadcastReload sends a reload command to a connected client", async (t) => {
  const server = await startMessageServer();
  t.after(server.close);

  const sent = await broadcastReload(server.port);
  const received = await server.waitForMessage();

  assert.equal(sent, true);
  assert.equal(received.length, 1);
  assert.deepEqual(JSON.parse(received[0]), { version: 2, method: "reload" });
});

test("broadcastReload resolves false when nothing is listening", async () => {
  assert.equal(await broadcastReload(closedPort), false);
});

test("broadcastReload resolves false rather than throwing on a server that is not a websocket", async (t) => {
  const http = createServer((_request, response) => response.end("not a websocket"));
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => http.close(resolve)));

  assert.equal(await broadcastReload(http.address().port), false);
});

after(() => {
  // node:test would otherwise sit on ws's keep-alive handles.
  setTimeout(() => process.exit(0), 100).unref();
});
