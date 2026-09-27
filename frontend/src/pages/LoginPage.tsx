import { authFieldErrors, PASSWORD_HINT, USERNAME_HINT, safeAuthReturnTo } from "@scripta/shared";
import { PasswordInput } from "../auth/PasswordInput";
import { afterSignIn, clearAuthNotice, readAuthNotice, startAuthNavigation } from "../auth/returnTo";
import { modeFromSearch, type AuthMode as Mode } from "../lib/landing";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { API_URL } from "../api/baseUrl";
import { ApiError, publicFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { createGoogleOAuthState } from "../auth/googleOAuthState";
import {
  AuthCard,
  AuthFieldError,
  AuthHeading,
  AuthServerError,
  AuthStage,
  authFieldClass,
  authFieldErrorClass,
  authHintClass,
  authLabelClass,
  authLinkClass,
  authSecondaryClass,
  authSubmitClass
} from "../auth/AuthStage";

// Google's own official "G" mark (Identity branding guidelines) — inlined
// rather than fetched from Google's asset host, same offline-friendly
// reasoning as every other icon in this app (e.g. BookCard.tsx's
// BookIcon): no network request just to render a static logo.
const GoogleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
  </svg>
);

export function LoginPage() {
  const { session, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<Mode>(() => modeFromSearch(new URLSearchParams(location.search)));
  // In login mode this doubles as "email or username"; in signup mode
  // it's strictly the email (username gets its own field below).
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [remember, setRemember] = useState(false);
  const locked = useRef(false);
  const from = (location.state as { from?: { pathname: string; search?: string; hash?: string }; returnTo?: string } | null);
  const redirectTo = safeAuthReturnTo(from?.returnTo ?? (from?.from ? `${from.from.pathname}${from.from.search ?? ""}${from.from.hash ?? ""}` : new URLSearchParams(location.search).get("returnTo")), "/dashboard");
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [notice] = useState(readAuthNotice);

  useEffect(() => {
    publicFetch("/auth/providers")
      .then((body) => setGoogleAvailable(Boolean((body as { google?: boolean }).google)))
      .catch(() => setGoogleAvailable(false));
  }, []);

  useEffect(() => clearAuthNotice(), []);

  useEffect(() => {
    const restore = () => { locked.current = false; setSubmitting(false); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  // Already signed in — don't show the login form. (RequireUsername
  // handles routing an incomplete Google account onward from here.)
  if (session) {
    return <Navigate to={afterSignIn(session.user.username)} replace />;
  }

  function startGoogleSignIn(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setSubmitting(true);
    try {
      startAuthNavigation(redirectTo, false);
      sessionStorage.setItem("scripta_auth_remember", String(remember));
      const url = new URL(`${API_URL}/auth/google`);
      url.searchParams.set("client_state", createGoogleOAuthState());
      window.location.assign(url.toString());
    } catch {
      locked.current = false;
      setSubmitting(false);
      setError("Your browser couldn’t save this sign-in. Allow site storage and try again.");
    }
  }

  function clearFieldError(e: React.FormEvent<HTMLInputElement>) {
    if (fieldErrors[e.currentTarget.id]) {
      setFieldErrors(({ [e.currentTarget.id]: _cleared, ...rest }) => rest);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current) return;
    setError(null);
    const errors = authFieldErrors(mode, identifier, username, password);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      document.getElementById(Object.keys(errors)[0]!)?.focus();
      return;
    }
    locked.current = true;
    setSubmitting(true);
    try {
      startAuthNavigation(redirectTo, mode === "signup");
      if (mode === "login") {
        await login(identifier.trim(), password, remember);
        navigate(redirectTo, { replace: true });
      } else {
        await signup(identifier.trim(), username.trim(), password, remember);
        // New accounts continue into the (skippable) avatar step — part of
        // the signup journey, not a gate; logins never see it.
        navigate("/welcome-avatar", { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setFieldErrors({ [err.field]: err.message });
        document.getElementById(err.field)?.focus();
      } else setError(err instanceof TypeError ? "Couldn’t connect. Check your connection and try again." : err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      locked.current = false;
      setSubmitting(false);
    }
  }

  const message = (location.state as { message?: string } | null)?.message ?? notice;

  function switchMode() {
    setMode(mode === "login" ? "signup" : "login");
    setError(null);
    setFieldErrors({});
  }

  return (
    <AuthStage>
      <AuthCard>
        <AuthHeading
          title={mode === "login" ? "Log in" : "Create your library"}
          subtitle={mode === "login" ? "Welcome back to your library." : "You can import your books from Kobo, Goodreads or StoryGraph right after."}
        />

        {message && <p role="status" className="mb-5 text-sm">{message}</p>}
        <AuthServerError message={error} />

        <form onSubmit={handleSubmit} noValidate>
          <fieldset disabled={submitting}>
          <div className="mb-4">
            <label className={authLabelClass} htmlFor="identifier">
              {mode === "login" ? "Email or username" : "Email"}
            </label>
            <input
              id="identifier"
              type={mode === "login" ? "text" : "email"}
              required
              autoComplete={mode === "signup" ? "email" : "username"}
              autoCapitalize="none" spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onInput={clearFieldError}
              aria-invalid={Boolean(fieldErrors.identifier)}
              aria-describedby={fieldErrors.identifier ? "identifier-error" : undefined}
              className={fieldErrors.identifier ? authFieldErrorClass : authFieldClass}
            />
            <AuthFieldError id="identifier-error" message={fieldErrors.identifier} />
          </div>

          {/* Always mounted (never conditionally added/removed) — that's
              what lets `gridTemplateRows` actually animate between 0fr and
              1fr below; a field that's mounted/unmounted on mode switch
              has no "previous height" to transition from, it just pops.
              `disabled` while collapsed (not just visually hidden) so it's
              unreachable by Tab and excluded from the form's constraint
              validation for free — `required` only applies when it's
              actually the field being asked for. */}
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-in-out"
            style={{ gridTemplateRows: mode === "signup" ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <div className="mb-4">
                <label className={authLabelClass} htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  required={mode === "signup"}
                  disabled={mode !== "signup"}
                  minLength={3}
                  maxLength={30}
                  pattern="[a-zA-Z0-9_.]+"
                  title="Letters, numbers, underscores, and periods only."
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onInput={clearFieldError}
                  aria-invalid={Boolean(fieldErrors.username)}
                  aria-describedby={fieldErrors.username ? "username-error" : undefined}
                  className={fieldErrors.username ? authFieldErrorClass : authFieldClass}
                />
                {fieldErrors.username ? <AuthFieldError id="username-error" message={fieldErrors.username} /> : <p className={authHintClass}>{USERNAME_HINT}</p>}
              </div>
            </div>
          </div>

          <div>
            <label className={authLabelClass} htmlFor="password">
              Password
            </label>
            <PasswordInput
              key={mode}
              id="password"
              type="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onInput={clearFieldError}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              className={fieldErrors.password ? authFieldErrorClass : authFieldClass}
            />
            {fieldErrors.password ? <AuthFieldError id="password-error" message={fieldErrors.password} /> : mode === "signup" && <p className={authHintClass}>{PASSWORD_HINT}</p>}
          </div>

          <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-x-4 text-sm">
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4" />Remember me</label>
            {mode === "login" && <Link to={`/forgot-password?email=${encodeURIComponent(identifier.includes("@") ? identifier : "")}`} className={`flex min-h-11 items-center ${authLinkClass}`}>Forgot password?</Link>}
          </div>
          <button type="submit" disabled={submitting} className={authSubmitClass}>
            {submitting ? (mode === "login" ? "Logging in…" : "Creating account…") : mode === "login" ? "Log in" : "Create account"}
          </button>
          </fieldset>
        </form>

        {googleAvailable && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-(--color-text-dim)">
              <span className="h-px flex-1 bg-(--color-border)" />
              or
              <span className="h-px flex-1 bg-(--color-border)" />
            </div>
            <a href={`${API_URL}/auth/google`} onClick={startGoogleSignIn} className={authSecondaryClass}>
              <GoogleLogo />
              Continue with Google
            </a>
          </>
        )}

        <p className="mt-6 text-center text-sm text-(--color-text-dim)">
          {mode === "login" ? "New to Atmyshelf?" : "Already have an account?"}{" "}
          <button type="button" onClick={switchMode} disabled={submitting} className={`inline-flex min-h-11 items-center ${authLinkClass}`}>
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </p>
      </AuthCard>
    </AuthStage>
  );
}
