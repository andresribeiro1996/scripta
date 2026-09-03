// Decides which browser origins may call this API — the `origin` option
// app.ts hands to @fastify/cors.
//
// Normally that's exactly one origin, FRONTEND_URL, and this file is a
// long-winded way of saying so. The reason it isn't just a string is
// testing on a real phone: the device loads the dev server over the LAN
// (http://192.168.1.20:5173), so its requests carry an Origin that no
// fixed FRONTEND_URL can predict — the machine's IP changes with the
// DHCP lease, and hardcoding today's into .env means editing it back out
// later. ALLOW_LAN_ORIGINS=true instead widens the allowance to private-
// network origins on any port, for as long as that flag is set.
//
// Deliberately opt-in and off by default: a production deployment should
// never accept anything but its own frontend, and shouldn't depend on
// this file guessing what "production" means (there's no NODE_ENV in
// config/env.ts to key off, and inventing one just for this would be a
// worse trade than an explicit flag). backend/scripts/dev-mobile.mjs is
// what actually sets it, per-process, never in a committed .env.

import { env } from "./env.js";

/** RFC 1918 private ranges, plus loopback — the addresses a phone and a
 *  dev machine on the same Wi-Fi can actually reach each other on. */
const PRIVATE_HOSTNAME =
  /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])$/;

function isPrivateNetworkOrigin(origin: string): boolean {
  let hostname: string;
  try {
    ({ hostname } = new URL(origin));
  } catch {
    // Not a parseable origin at all — nothing to allow.
    return false;
  }
  // URL puts IPv6 hostnames in brackets already ("[::1]"); the regex
  // above matches that form directly.
  return PRIVATE_HOSTNAME.test(hostname);
}

/**
 * @param origin The request's Origin header — undefined for requests that
 *   don't send one at all (curl, a plain `<img src>`, same-origin
 *   navigation). Those aren't cross-origin requests, so there's nothing
 *   for CORS to withhold and they're allowed through untouched.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === env.FRONTEND_URL) return true;
  return env.ALLOW_LAN_ORIGINS && isPrivateNetworkOrigin(origin);
}
