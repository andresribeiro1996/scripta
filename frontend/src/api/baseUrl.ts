// Where this app's API lives. One shared constant rather than the same
// `import.meta.env.VITE_API_URL ?? ...` expression repeated in every file
// that needs it (client.ts, socials.ts, LoginPage.tsx all had their own
// copy).
//
// VITE_API_URL still wins whenever it's set — that's what a real
// deployment configures. What changed is the fallback: instead of a
// hardcoded "http://localhost:3000", the base is derived from whatever
// host the app itself was loaded from. On a desktop that host IS
// localhost, so the derived value is byte-identical to the old default
// and nothing about the normal `npm run dev` loop changes.
//
// The reason it's derived at all is testing on a real phone: open
// http://192.168.1.20:5173 on a device on the same Wi-Fi and its API
// calls go to http://192.168.1.20:3000 on their own, with no per-machine
// .env editing (and nothing to remember to revert afterwards). See
// "Testing on a phone" in the root README.

/** The backend's own default port — see backend/.env.example's PORT. */
const DEFAULT_API_PORT = 3000;

export const API_URL =
  import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}`;
