// The one place VITE_API_URL is read.
//
// It is substituted by Vite at BUILD time, not read at runtime, so
// pointing a deployment at a different API means rebuilding — an env-var
// edit on the host does nothing. Three files used to duplicate the
// `?? "http://localhost:3000"` fallback, which meant a production build
// with the variable unset silently shipped a bundle that called
// localhost, failing only once it was in someone's browser.
//
// The fallback now applies to dev only. A production build missing the
// variable is caught in vite.config.ts and fails the build itself, which
// is where a misconfiguration should surface — in CI, not in a user's
// browser. This module's own check is the belt to that braces, covering
// anything that reaches production without going through that build path.

const configured = import.meta.env.VITE_API_URL;

if (import.meta.env.PROD && !configured) {
  throw new Error(
    "VITE_API_URL was not set when this bundle was built. The API URL is baked in at build time — rebuild with VITE_API_URL pointing at the deployed API."
  );
}

/** Base URL of the AtMyShelf API, without a trailing slash. */
export const API_URL: string = (configured ?? "http://localhost:3000").replace(/\/+$/, "");
