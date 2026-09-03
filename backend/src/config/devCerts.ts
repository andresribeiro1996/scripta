// Serves the API over https when DEV_HTTPS_CERT_PATH/DEV_HTTPS_KEY_PATH
// are set — needed to test the PWA install/offline flow on a phone (a
// service worker only runs in a secure context, and a plain LAN address
// over http isn't one). app.ts passes this straight to Fastify's own
// `https` constructor option.
//
// Those two env vars are how this gets the paths rather than computing
// them itself: `npm run dev:mobile` (backend/scripts/dev-mobile.mjs) is
// the one place that knows whether scripts/gen-mobile-certs.mjs has been
// run and where it wrote the pair, and hands that down the same way it
// already hands down PUBLIC_API_URL — through env, like every other
// config value here (see this module's own env.ts header comment for
// why: a value read through config/env.ts fails loudly at boot instead
// of somewhere deep in a request handler).
//
// Blank (the default) and this is `undefined`, and Fastify serves plain
// http exactly as before.

import { readFileSync } from "node:fs";
import { env } from "./env.js";

export const devHttps =
  env.DEV_HTTPS_CERT_PATH && env.DEV_HTTPS_KEY_PATH
    ? { key: readFileSync(env.DEV_HTTPS_KEY_PATH), cert: readFileSync(env.DEV_HTTPS_CERT_PATH) }
    : undefined;
