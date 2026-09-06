import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { API_URL } from "../api/baseUrl";
import { publicFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  GOLD,
  INK,
  PAPER,
  PAPER_DIM,
  PAPER_FAINT,
  AuthBrandHeading,
  AuthCard,
  AuthFieldError,
  AuthServerError,
  AuthStage,
  authFieldClass,
  authFieldErrorClass,
  authLabelClass,
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

type Mode = "login" | "signup";

export function LoginPage() {
  const { session, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<Mode>("login");
  // In login mode this doubles as "email or username"; in signup mode
  // it's strictly the email (username gets its own field below).
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    publicFetch("/auth/providers")
      .then((body) => setGoogleAvailable(Boolean((body as { google?: boolean }).google)))
      .catch(() => setGoogleAvailable(false));
  }, []);

  // Already signed in — don't show the login form. (RequireUsername
  // handles routing an incomplete Google account onward from here.)
  if (session) {
    const redirectTo = (location.state as { from?: Location } | null)?.from?.pathname ?? "/dashboard";
    return <Navigate to={redirectTo} replace />;
  }

  // Native constraint validation, but reported inline under each field
  // instead of a browser tooltip: preventDefault() on `invalid` (which
  // fires per-field on a failed submit) suppresses the bubble, and the
  // message lands in state. Cleared as soon as the user edits the field.
  function handleInvalid(e: React.InvalidEvent<HTMLInputElement>) {
    e.preventDefault();
    setFieldErrors((prev) => ({ ...prev, [e.currentTarget.id]: e.currentTarget.validationMessage }));
  }

  function clearFieldError(e: React.FormEvent<HTMLInputElement>) {
    if (fieldErrors[e.currentTarget.id]) {
      setFieldErrors(({ [e.currentTarget.id]: _cleared, ...rest }) => rest);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(identifier, password);
        const redirectTo = (location.state as { from?: Location } | null)?.from?.pathname ?? "/dashboard";
        navigate(redirectTo, { replace: true });
      } else {
        await signup(identifier, username, password);
        // New accounts continue into the (skippable) avatar step — part of
        // the signup journey, not a gate; logins never see it.
        navigate("/welcome-avatar", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthStage>
      <AuthCard>
        <AuthBrandHeading subtitle={mode === "login" ? "Welcome back to your library" : "Set up your library account"} />

        {/* Segmented mode toggle — one containing border, active half tinted gold. */}
        <div
          className="mb-6 flex overflow-hidden rounded-lg text-[12px] font-semibold"
          style={{ border: `1px solid ${PAPER_FAINT}`, backgroundColor: "rgba(242, 237, 230, 0.04)" }}
          role="tablist"
          aria-label="Log in or sign up"
        >
          {(["login", "signup"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className="flex-1 py-2 transition-colors"
              style={
                mode === value
                  ? { backgroundColor: "rgba(224, 138, 82, 0.16)", color: GOLD }
                  : { color: PAPER_DIM }
              }
            >
              {value === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        <AuthServerError message={error} />

        <form onSubmit={handleSubmit} noValidate={false}>
          <div className="mb-4">
            <label className={authLabelClass} style={{ color: PAPER_DIM }} htmlFor="identifier">
              {mode === "login" ? "Email or username" : "Email"}
            </label>
            <input
              id="identifier"
              type={mode === "login" ? "text" : "email"}
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onInvalid={handleInvalid}
              onInput={clearFieldError}
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
                <label className={authLabelClass} style={{ color: PAPER_DIM }} htmlFor="username">
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
                  onInvalid={handleInvalid}
                  onInput={clearFieldError}
                  aria-describedby={fieldErrors.username ? "username-error" : undefined}
                  className={fieldErrors.username ? authFieldErrorClass : authFieldClass}
                />
                <AuthFieldError id="username-error" message={fieldErrors.username} />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <label className={authLabelClass} style={{ color: PAPER_DIM }} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onInvalid={handleInvalid}
              onInput={clearFieldError}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              className={fieldErrors.password ? authFieldErrorClass : authFieldClass}
            />
            <AuthFieldError id="password-error" message={fieldErrors.password} />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={authSubmitClass}
            style={{ backgroundColor: GOLD, color: INK }}
          >
            {submitting ? "…" : mode === "login" ? "Log in" : "Create account"}
          </button>

          {googleAvailable && (
            <>
              <div className="my-5 flex items-center gap-3 text-[10px] tracking-[0.2em] uppercase" style={{ color: PAPER_DIM }}>
                <span className="h-px flex-1" style={{ backgroundColor: PAPER_FAINT }} />
                or
                <span className="h-px flex-1" style={{ backgroundColor: PAPER_FAINT }} />
              </div>
              {/* Solid, not transparent — Google's own branding guidelines
                  never show the mark on a see-through surface. PAPER/INK
                  (this page's "light" tokens) rather than plain white/
                  black, so it still reads as this page's own paper-on-a-
                  dark-cover material, not a foreign white rectangle
                  dropped on top of it. Text stays "Sign in with Google"
                  regardless of `mode` — signing in via Google IS the
                  account action either way (a new account gets created on
                  first use, same as it already does), there's no separate
                  "sign up with Google" flow to word this differently for. */}
              <a
                href={`${API_URL}/auth/google`}
                className="flex w-full items-center justify-center gap-2.5 rounded-lg border py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
                style={{ borderColor: PAPER, backgroundColor: PAPER, color: INK }}
              >
                <GoogleLogo />
                Sign in with Google
              </a>
            </>
          )}
        </form>
      </AuthCard>
    </AuthStage>
  );
}
