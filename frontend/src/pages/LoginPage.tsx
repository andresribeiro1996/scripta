import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { publicFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { API_URL } from "../config";

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

// This page deliberately does NOT use the app's --color-* theme
// variables (see index.css) — everywhere else, following the user's
// light/dark preference is the right call, but the login page is the
// app's "cover," not a working screen, and the ink-illustration wordmark
// (public/logo.png — a dark, hand-drawn/stippled mark, see its own
// comment below) only reads as intended against one deliberately chosen,
// fixed backdrop, the same way a book jacket doesn't relayout itself for
// the reader's e-reader theme. Palette picked once, hardcoded, doesn't
// move with the OS: a near-black ground, off-white ink, and the app's
// own dark-mode accent value used as a fixed warm highlight (chosen
// specifically over the light-mode value — it's the one that actually
// reads as "gold foil on a dark cover").
const INK = "#0d0c0b";
const PAPER = "#f2ede6";
const PAPER_DIM = "rgba(242, 237, 230, 0.45)";
const PAPER_FAINT = "rgba(242, 237, 230, 0.18)";
const GOLD = "#e08a52";

// logo.png's actual pixel dimensions — needed to compute a *capped* cover
// size below (a plain CSS `background-size: cover` has no ceiling: on a
// window shape very different from the image's own aspect ratio, it
// scales the artwork up as far as needed to fill every pixel, which can
// blow a fine dot-stippled illustration up past the point of being
// recognizable as anything but abstract texture).
const LOGO_NATURAL_WIDTH = 992;
const LOGO_NATURAL_HEIGHT = 1070;
// The most the watermark is ever allowed to scale up from its natural
// pixel size. Comfortably covers ordinary desktop/laptop window shapes
// with no visible gap; only on unusually tall-and-narrow or short-and-wide
// windows does this trade a little edge coverage for keeping the mark
// legible — a trade the alternative (`cover`, no cap) doesn't offer at
// all.
const LOGO_MAX_SCALE = 1.7;

/** The `background-size` (in px, both axes) that covers `window.inner{Width,Height}`
 *  the same way CSS `cover` would — same "larger of the two ratios" math —
 *  except clamped to LOGO_MAX_SCALE. Recomputed on resize; SSR-safe isn't
 *  a real concern here (this is a plain CSR Vite app), but the lazy
 *  initializer still guards the (harmless) case of `window` not existing
 *  yet at module-eval time. */
function useCappedCoverSize() {
  function compute() {
    if (typeof window === "undefined") return { width: LOGO_NATURAL_WIDTH, height: LOGO_NATURAL_HEIGHT };
    const coverScale = Math.max(window.innerWidth / LOGO_NATURAL_WIDTH, window.innerHeight / LOGO_NATURAL_HEIGHT);
    const scale = Math.min(coverScale, LOGO_MAX_SCALE);
    return { width: LOGO_NATURAL_WIDTH * scale, height: LOGO_NATURAL_HEIGHT * scale };
  }

  const [size, setSize] = useState(compute);

  useEffect(() => {
    function handleResize() {
      setSize(compute());
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return size;
}

export function LoginPage() {
  const { session, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const bgSize = useCappedCoverSize();

  const [mode, setMode] = useState<Mode>("login");
  // In login mode this doubles as "email or username"; in signup mode
  // it's strictly the email (username gets its own field below).
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") await login(identifier, password);
      else await signup(identifier, username, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  // Shared underline-style input — no box, no fill, just a rule that
  // brightens on focus. The whole point of stripping the old bordered
  // card away: let the wordmark above carry all the visual weight, and
  // keep everything below it as quiet as a colophon page.
  const fieldClass =
    "w-full border-0 border-b bg-transparent px-0 py-2 text-[15px] outline-none transition-colors";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-16" style={{ backgroundColor: INK, color: PAPER }}>
      {/* The illustrated mark as huge, faint atmosphere behind everything
          — not a legible logo lockup anymore, ambient texture, the way a
          wax seal or a colophon sits behind a book's title page. Sized via
          useCappedCoverSize() above rather than plain `background-size:
          cover` — cover alone fills every pixel on ANY aspect ratio, but
          has no ceiling: on a window shape very different from the
          image's own, that can zoom a fine dot-stippled illustration up
          past the point of reading as anything but abstract texture (a
          real problem hit while building this — see that function's own
          comment). Still inverted (see this file's header comment) so the
          dark ink reads as pale marks against this dark ground; opacity
          does the actual "low opacity" work on top of that.
          `pointer-events-none` + `aria-hidden` since it's decoration, not
          content — the real wordmark is the plain text heading below,
          which stays legible at full contrast regardless of how faint
          this is. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 select-none"
        style={{
          backgroundImage: "url(/logo.png)",
          backgroundSize: `${bgSize.width}px ${bgSize.height}px`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          filter: "invert(1) brightness(1.1)",
          opacity: 0.07
        }}
      />

      <div className="relative z-10 w-full max-w-[360px]">
        <div className="mb-12 flex flex-col items-center text-center">
          <h1 className="text-2xl tracking-[0.2em] uppercase" style={{ color: PAPER, fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>
            Scripta
          </h1>
          <p className="mt-4 text-[11px] tracking-[0.25em] uppercase" style={{ color: PAPER_DIM }}>
            Your books, wherever you left off
          </p>
        </div>

        <div className="mb-10 flex items-center justify-center gap-5 text-sm">
          <button
            type="button"
            onClick={() => setMode("login")}
            className="border-b pb-1 tracking-wide transition-colors"
            style={
              mode === "login"
                ? { borderColor: PAPER, color: PAPER, fontWeight: 600 }
                : { borderColor: "transparent", color: PAPER_DIM }
            }
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className="border-b pb-1 tracking-wide transition-colors"
            style={
              mode === "signup"
                ? { borderColor: PAPER, color: PAPER, fontWeight: 600 }
                : { borderColor: "transparent", color: PAPER_DIM }
            }
          >
            Sign up
          </button>
        </div>

        {error && (
          <div
            className="mb-6 border-l-2 px-3 py-2 text-center text-xs"
            style={{ borderColor: "#c96a52", color: "#e3a292" }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label className="mb-1.5 block text-[10.5px] tracking-[0.18em] uppercase" style={{ color: PAPER_DIM }} htmlFor="identifier">
              {mode === "login" ? "Email or username" : "Email"}
            </label>
            <input
              id="identifier"
              type={mode === "login" ? "text" : "email"}
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className={fieldClass}
              style={{ borderColor: PAPER_FAINT, color: PAPER }}
              onFocus={(e) => (e.currentTarget.style.borderColor = GOLD)}
              onBlur={(e) => (e.currentTarget.style.borderColor = PAPER_FAINT)}
            />
          </div>

          {/* Always mounted (never conditionally added/removed) — that's
              what lets `gridTemplateRows` actually animate between 0fr and
              1fr below; a field that's mounted/unmounted on mode switch
              has no "previous height" to transition from, it just pops.
              `disabled` while collapsed (not just visually hidden) so it's
              unreachable by Tab and excluded from the form's constraint
              validation for free — `required` only applies when it's
              actually the field being asked for. */}
          <div className="grid transition-[grid-template-rows] duration-300 ease-in-out" style={{ gridTemplateRows: mode === "signup" ? "1fr" : "0fr" }}>
            <div className="overflow-hidden">
              <div className="mb-6">
                <label className="mb-1.5 block text-[10.5px] tracking-[0.18em] uppercase" style={{ color: PAPER_DIM }} htmlFor="username">
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
                  className={fieldClass}
                  style={{ borderColor: PAPER_FAINT, color: PAPER }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = GOLD)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = PAPER_FAINT)}
                />
              </div>
            </div>
          </div>

          <div className="mb-10">
            <label className="mb-1.5 block text-[10.5px] tracking-[0.18em] uppercase" style={{ color: PAPER_DIM }} htmlFor="password">
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
              className={fieldClass}
              style={{ borderColor: PAPER_FAINT, color: PAPER }}
              onFocus={(e) => (e.currentTarget.style.borderColor = GOLD)}
              onBlur={(e) => (e.currentTarget.style.borderColor = PAPER_FAINT)}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full border py-3 text-xs font-semibold tracking-[0.2em] uppercase transition-colors disabled:opacity-40"
            style={{ borderColor: GOLD, color: submitting ? PAPER : INK, backgroundColor: submitting ? "transparent" : GOLD }}
          >
            {submitting ? "…" : mode === "login" ? "Log in" : "Create account"}
          </button>

          {googleAvailable && (
            <>
              <div className="my-7 flex items-center gap-3 text-[10px] tracking-[0.2em] uppercase" style={{ color: PAPER_DIM }}>
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
                className="flex w-full items-center justify-center gap-2.5 border py-3 text-sm font-medium transition-opacity hover:opacity-90"
                style={{ borderColor: PAPER, backgroundColor: PAPER, color: INK }}
              >
                <GoogleLogo />
                Sign in with Google
              </a>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
