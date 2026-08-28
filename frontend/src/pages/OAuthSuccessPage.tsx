import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { setSession } from "../auth/tokenStore";

/** Google's callback (see backend/src/modules/auth/plugin.ts) redirects
 *  here with tokens riding the URL fragment rather than a request body —
 *  fragments never reach a server, unlike query params. The access
 *  token's own claims carry the user id/email/username, decoded locally
 *  rather than spending a /auth/me round trip just to land on the
 *  dashboard. A first-time Google sign-in has no username yet (`null`) —
 *  navigating to /dashboard still works in that case: RequireUsername
 *  (nested under it, see App.tsx) catches the missing username and
 *  redirects to /choose-username itself. */
export function OAuthSuccessPage() {
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  // React 18 StrictMode double-invokes effects in dev mode (mount, run,
  // simulate-unmount, run again) to surface exactly this class of bug:
  // this effect's own `history.replaceState` call mutates the URL as a
  // side effect, so a naive second run would re-parse an already-scrubbed
  // hash, find no tokens, and stomp the correct "done" status with
  // "error" — even though the session was already set correctly by the
  // first run. This ref makes the actual parse-and-set-session logic run
  // exactly once no matter how many times the effect itself fires.
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      setStatus("error");
      return;
    }

    try {
      const payloadBase64 = accessToken.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(atob(payloadBase64)) as { sub: string; email: string; username: string | null };
      setSession({ user: { id: claims.sub, email: claims.email, username: claims.username }, accessToken, refreshToken });
      // Scrub the tokens out of the URL so they don't linger in history/bookmarks.
      window.history.replaceState(null, "", window.location.pathname);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }, []);

  if (status === "error") {
    return (
      <div className="mx-auto max-w-sm px-5 py-20 text-center text-sm text-(--color-danger)">
        Something went wrong signing you in with Google.{" "}
        <a href="/login" className="underline">
          Try again
        </a>
        .
      </div>
    );
  }

  if (status === "done") return <Navigate to="/dashboard" replace />;

  return <div className="px-5 py-20 text-center text-sm text-(--color-text-dim)">Signing you in…</div>;
}
