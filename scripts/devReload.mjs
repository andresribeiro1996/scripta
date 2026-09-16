// Push a reload to whatever Expo Go is already attached to this
// worktree's Metro — the same broadcast `expo start` sends when you press
// `r` (@expo/cli's interactiveActions.js: devServerManager.broadcastMessage
// ('reload'), which reaches devices over Metro's /message websocket).
//
// dev-phone.mjs exists to be re-run whenever something looks off, but
// re-running it could not fix the most common thing that IS off: Expo Go
// keeps executing the bundle it already loaded when its Metro is replaced,
// so a phone left open across a restart silently serves pre-restart code.
// dev-emulator.mjs never had this problem — it force-launches the app with
// `adb shell am start -d exp://...`, which makes Expo Go re-fetch. A
// physical phone is exactly the case that can't be driven over adb.

const RELOAD_TIMEOUT_MS = 2000;

/** Resolves true when a reload was sent, false when no Metro/client was
 *  reachable. Never rejects: a reload that didn't land must not fail a boot
 *  that otherwise worked, but the caller still needs to know which happened
 *  so it can say so rather than print an unverified success. */
export function broadcastReload(port) {
  return new Promise((resolve) => {
    let socket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${port}/message`);
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (sent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Already closing or closed — the result above still stands.
      }
      resolve(sent);
    };

    const timer = setTimeout(() => finish(false), RELOAD_TIMEOUT_MS);
    socket.onerror = () => finish(false);
    socket.onclose = () => finish(false);
    socket.onopen = () => {
      socket.send(JSON.stringify({ version: 2, method: "reload" }));
      finish(true);
    };
  });
}
