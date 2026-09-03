// `npm run dev:mobile` — the dev server, set up so a phone on the same
// Wi-Fi can actually use it.
//
// Three things have to be true for that, and all three depend on this
// machine's LAN address, which is exactly the thing you don't want to
// hardcode into a committed .env (it changes with the DHCP lease, and
// pinning it there means remembering to take it back out):
//
//   PUBLIC_API_URL     Cover and gallery images are served as ABSOLUTE
//                      urls built from this (modules/gallery/plugin.ts,
//                      modules/covers/plugin.ts). Left at its localhost
//                      default, every image on the phone resolves to the
//                      PHONE's own localhost and the whole grid renders
//                      broken — the single most confusing way this setup
//                      fails, since the app otherwise looks fine.
//   ALLOW_LAN_ORIGINS  CORS. The device's Origin is the LAN address, not
//                      FRONTEND_URL. See config/corsOrigin.ts.
//   DEV_HTTPS_*_PATH   Only set when `node scripts/gen-mobile-certs.mjs`
//                      (repo root) has been run — switches the API to
//                      https, matching the frontend doing the same (see
//                      vite.config.ts). Skipped entirely otherwise, so
//                      this stays plain http until you've deliberately
//                      opted into testing the PWA install/offline flow.
//
// So: detect the address, set these for this process only, hand off to
// the normal dev server. Nothing is written to disk, and a plain
// `npm run dev` is completely unaffected.
//
// Override the detected address with `LAN_IP=192.168.1.20 npm run
// dev:mobile` when the guess is wrong (VPNs and Docker bridges are the
// usual reason — see scripts/lanAddress.mjs).

import { spawn } from "node:child_process";
import { pickLanAddress } from "../../scripts/lanAddress.mjs";
import { CERT_PATH, KEY_PATH, mobileCertsExist } from "../../scripts/mobileCertPaths.mjs";

const PORT = process.env.PORT ?? "3000";

const lanIp = process.env.LAN_IP ?? pickLanAddress();

if (!lanIp) {
  console.error(
    "dev:mobile: couldn't find a LAN address on any network interface.\n" +
      "Is this machine on Wi-Fi/Ethernet? You can also pass one explicitly:\n" +
      "  LAN_IP=192.168.1.20 npm run dev:mobile"
  );
  process.exit(1);
}

const useHttps = mobileCertsExist();
const publicApiUrl = `${useHttps ? "https" : "http"}://${lanIp}:${PORT}`;

console.log(`\n  API reachable on the LAN at ${publicApiUrl}`);
console.log(`  Image urls (covers, gallery) will be built from that address.`);
console.log(`  CORS is accepting private-network origins for this run.`);
if (useHttps) {
  console.log(`  Serving https, using the cert from scripts/gen-mobile-certs.mjs.`);
} else {
  console.log(
    `  Serving plain http — fine for browsing, but "Add to Home Screen" and offline\n` +
      `  caching need https. Run \`node scripts/gen-mobile-certs.mjs\` at the repo root\n` +
      `  once to enable that (see root README's "Testing on a phone").`
  );
}
console.log(`\n  Start the frontend with \`npm run dev:mobile\` in frontend/, then open`);
console.log(`  the "Network:" url it prints on your phone.\n`);

// stdio: "inherit" so tsx's watch output and Fastify's request logs land
// in this terminal exactly as they do under a plain `npm run dev`.
const child = spawn("npm", ["run", "dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    PUBLIC_API_URL: publicApiUrl,
    ALLOW_LAN_ORIGINS: "true",
    ...(useHttps ? { DEV_HTTPS_CERT_PATH: CERT_PATH, DEV_HTTPS_KEY_PATH: KEY_PATH } : {})
  }
});

child.on("exit", (code, signal) => {
  // Mirror however the dev server itself went down, so Ctrl-C here
  // behaves the same as Ctrl-C on `npm run dev`.
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
