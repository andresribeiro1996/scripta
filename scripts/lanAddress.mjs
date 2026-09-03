// This machine's own LAN IPv4 address — the one a phone on the same
// router can reach. Shared by backend/scripts/dev-mobile.mjs (to build
// PUBLIC_API_URL) and scripts/gen-mobile-certs.mjs (to put the same
// address in the cert's SAN list) so the two never drift apart.
//
// Interfaces come back in no particular useful order and a dev machine
// usually has several (loopback, Docker bridges, VPN tunnels, sometimes
// both Wi-Fi and Ethernet), so this prefers the ranges a home network
// actually hands out, and falls back to any non-internal IPv4 rather
// than giving up.

import { networkInterfaces } from "node:os";

export function pickLanAddress() {
  const candidates = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal);

  // 192.168.x.x is what the overwhelming majority of home routers assign,
  // so it beats a 10.x.x.x that's more often a VPN or corporate tunnel.
  return (
    candidates.find((address) => address.address.startsWith("192.168."))?.address ??
    candidates.find((address) => /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address))?.address ??
    candidates[0]?.address
  );
}
