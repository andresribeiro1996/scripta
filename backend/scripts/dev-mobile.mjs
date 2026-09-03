// `npm run dev:mobile` — the dev server, set up so a phone on the same
// Wi-Fi can actually use it.
//
// Two things have to be true for that, and both depend on this machine's
// LAN address, which is exactly the thing you don't want to hardcode
// into a committed .env (it changes with the DHCP lease, and pinning it
// there means remembering to take it back out):
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
//
// So: detect the address, set both for this process only, hand off to
// the normal dev server. Nothing is written to disk, and a plain
// `npm run dev` is completely unaffected.
//
// Override the detected address with `LAN_IP=192.168.1.20 npm run
// dev:mobile` when the guess is wrong (VPNs and Docker bridges are the
// usual reason — see pickLanAddress below).

import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const PORT = process.env.PORT ?? "3000";

/**
 * This machine's LAN IPv4 address — the one a phone on the same router
 * can reach. Interfaces come back in no particular useful order and a
 * dev machine usually has several (loopback, Docker bridges, VPN
 * tunnels, sometimes both Wi-Fi and Ethernet), so this prefers the
 * ranges a home network actually hands out, and falls back to any
 * non-internal IPv4 rather than giving up.
 */
function pickLanAddress() {
  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ ...address, name })))
    .filter((address) => address.family === "IPv4" && !address.internal);

  // 192.168.x.x is what the overwhelming majority of home routers assign,
  // so it beats a 10.x.x.x that's more often a VPN or corporate tunnel.
  return (
    candidates.find((address) => address.address.startsWith("192.168."))?.address ??
    candidates.find((address) => /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address))?.address ??
    candidates[0]?.address
  );
}

const lanIp = process.env.LAN_IP ?? pickLanAddress();

if (!lanIp) {
  console.error(
    "dev:mobile: couldn't find a LAN address on any network interface.\n" +
      "Is this machine on Wi-Fi/Ethernet? You can also pass one explicitly:\n" +
      "  LAN_IP=192.168.1.20 npm run dev:mobile"
  );
  process.exit(1);
}

const publicApiUrl = `http://${lanIp}:${PORT}`;

console.log(`\n  API reachable on the LAN at ${publicApiUrl}`);
console.log(`  Image urls (covers, gallery) will be built from that address.`);
console.log(`  CORS is accepting private-network origins for this run.\n`);
console.log(`  Start the frontend with \`npm run dev:mobile\` in frontend/, then open`);
console.log(`  the "Network:" url it prints on your phone.\n`);

// stdio: "inherit" so tsx's watch output and Fastify's request logs land
// in this terminal exactly as they do under a plain `npm run dev`.
const child = spawn("npm", ["run", "dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, PUBLIC_API_URL: publicApiUrl, ALLOW_LAN_ORIGINS: "true" }
});

child.on("exit", (code, signal) => {
  // Mirror however the dev server itself went down, so Ctrl-C here
  // behaves the same as Ctrl-C on `npm run dev`.
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
