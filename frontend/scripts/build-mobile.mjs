// `npm run preview:mobile` — a production build served so a phone on the
// same Wi-Fi can install it and test offline caching for real.
//
// Why not just `npm run build && npm run preview --host`: two things
// need to agree with the backend, and vite.config.ts can't know them on
// its own —
//
//   VITE_API_URL   Left unset, the app derives its API base from
//                  whatever host it was loaded from (frontend/src/api/
//                  baseUrl.ts) — fine for the app's own fetches, but
//                  vite.config.ts ALSO bakes VITE_API_URL into the
//                  workbox runtime-caching url patterns (the /library
//                  StaleWhileRevalidate and /covers|gallery CacheFirst
//                  rules) at BUILD time. Leave it unset and those
//                  patterns default to "http://localhost:3000", which
//                  never matches a phone's actual "https://<lan-ip>:3000"
//                  requests — the app would install and open fine, just
//                  with offline caching silently not engaging. So this
//                  sets it explicitly, to whatever backend/scripts/
//                  dev-mobile.mjs is actually serving on.
//   https vs http  vite.config.ts's own server.https / preview.https
//                  (read from scripts/mobileCertPaths.mjs, same pair the
//                  backend uses) already switches the frontend itself to
//                  https once certs exist — this only needs to match
//                  that same choice in the VITE_API_URL above, or the
//                  page would load over https and call the API over
//                  http, which browsers block as mixed content.
//
// Run `node scripts/gen-mobile-certs.mjs` (repo root) once first, and
// have backend/'s `npm run dev:mobile` already running — this only
// serves the frontend half.

import { spawnSync, spawn } from "node:child_process";
import { pickLanAddress } from "../../scripts/lanAddress.mjs";
import { mobileCertsExist } from "../../scripts/mobileCertPaths.mjs";

// Matches backend/.env.example's own PORT default — override with
// VITE_API_PORT if the backend is running on something else.
const API_PORT = process.env.VITE_API_PORT ?? "3000";

const lanIp = process.env.LAN_IP ?? pickLanAddress();
if (!lanIp) {
  console.error(
    "preview:mobile: couldn't find a LAN address on any network interface.\n" +
      "Is this machine on Wi-Fi/Ethernet? You can also pass one explicitly:\n" +
      "  LAN_IP=192.168.1.20 npm run preview:mobile"
  );
  process.exit(1);
}

const useHttps = mobileCertsExist();
if (!useHttps) {
  console.log(
    "No cert found — run `node scripts/gen-mobile-certs.mjs` at the repo root first.\n" +
      "Without it this still builds and serves over plain http, but a phone's browser\n" +
      "won't register the service worker there (no secure context), so install/offline\n" +
      "won't actually work — only the ordinary app will.\n"
  );
}

const apiUrl = `${useHttps ? "https" : "http"}://${lanIp}:${API_PORT}`;
console.log(`Building with VITE_API_URL=${apiUrl} ...\n`);

const buildEnv = { ...process.env, VITE_API_URL: apiUrl };

const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: process.platform === "win32", env: buildEnv });
if (build.status !== 0) process.exit(build.status ?? 1);

console.log(`\nServing the build — open the "Network:" url below on your phone.\n`);

// stdio: "inherit" so Vite's own "Local/Network" url output lands here
// exactly as it does for a plain `vite preview`.
const preview = spawn("npx", ["vite", "preview", "--host"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: buildEnv
});

preview.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
