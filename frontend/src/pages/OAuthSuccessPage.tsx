import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { publicFetch } from "../api/client";
import { consumeGoogleOAuthState } from "../auth/googleOAuthState";
import { setSession } from "../auth/tokenStore";

interface ExchangeResponse {
  user: { id: string; email: string; username: string | null; avatarId: string | null };
  accessToken: string;
  refreshToken: string;
}

/** Google's callback (see backend/src/modules/auth/plugin.ts) redirects
 *  here with a short-lived, single-use `?code=` — never the tokens
 *  themselves (see the global "never place access or refresh tokens in
 *  URLs" constraint, and modules/auth/authorizationCode.ts for the code's
 *  own lifecycle). This page's whole job is exchanging that code for a
 *  session through POST /auth/google/exchange. The flow is bound to the
 *  browser tab by a nonce that LoginPage stores in sessionStorage and the
 *  backend echoes as `state`; this page rejects a callback unless they
 *  match. A first-time Google sign-in has no
 *  username yet (`null`) — navigating to /dashboard still works in that
 *  case: RequireUsername (nested under it, see App.tsx) catches the
 *  missing username and redirects to /choose-username itself. */
export function OAuthSuccessPage() {
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  // React 18 StrictMode double-invokes effects in dev mode (mount, run,
  // simulate-unmount, run again) to surface exactly this class of bug:
  // this effect's own `history.replaceState` call mutates the URL as a
  // side effect, so a naive second run would re-parse an already-scrubbed
  // query string, find no code, and stomp the correct "done" status with
  // "error" — even though the session was already set correctly by the
  // first run. It would also try to exchange the SAME code twice, which
  // the backend rejects outright (the code is single-use). This ref makes
  // the actual exchange-and-set-session logic run exactly once no matter
  // how many times the effect itself fires.
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const stateMatches = consumeGoogleOAuthState(params.get("state"));
    if (!code || !stateMatches) {
      window.history.replaceState(null, "", window.location.pathname);
      setStatus("error");
      return;
    }

    // Scrub the code out of the URL before attempting the exchange, not
    // after — it's single-use already, but a FAILED exchange (network
    // error, backend down, code already expired/used) must not leave
    // `?code=` sitting in history either. Reading `code` above already
    // happened, so this doesn't affect the exchange itself.
    window.history.replaceState(null, "", window.location.pathname);

    (async () => {
      try {
        const body = (await publicFetch("/auth/google/exchange", {
          method: "POST",
          body: JSON.stringify({ code })
        })) as ExchangeResponse;
        setSession({ user: body.user, accessToken: body.accessToken, refreshToken: body.refreshToken });
        setStatus("done");
      } catch {
        setStatus("error");
      }
    })();
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
