import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  GOLD,
  INK,
  PAPER_DIM,
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

/** Where a Google sign-in without a username yet gets routed (see
 *  RequireUsername). Not shown to password-signup accounts — they pick a
 *  username at signup time and never have a null one to begin with. Same
 *  cover-stage-plus-card treatment as LoginPage, so the whole first-run
 *  journey reads as one designed sequence. */
export function ChooseUsernamePage() {
  const { session, setUsername } = useAuth();
  const navigate = useNavigate();
  const [username, setUsernameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!session) return <Navigate to="/login" replace />;
  if (session.user.username) return <Navigate to="/dashboard" replace />;

  function handleInvalid(e: React.InvalidEvent<HTMLInputElement>) {
    e.preventDefault();
    setFieldError(e.currentTarget.validationMessage);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    setSubmitting(true);
    try {
      await setUsername(username);
      // Onward into the (skippable) avatar step — same signup journey a
      // password account takes after registering.
      navigate("/welcome-avatar", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthStage>
      <AuthCard>
        <AuthBrandHeading subtitle="One more thing before your library" />

        <p className="mb-6 text-center text-[12px]" style={{ color: PAPER_DIM }}>
          Choose a username for your account ({session.user.email}). You'll be able to log in with either it or your
          email from now on.
        </p>

        <AuthServerError message={error} />

        <form onSubmit={handleSubmit}>
          <label className={authLabelClass} style={{ color: PAPER_DIM }} htmlFor="username">
            Username
          </label>
          <input
            id="username"
            type="text"
            required
            minLength={3}
            maxLength={30}
            pattern="[a-zA-Z0-9_.]+"
            title="Letters, numbers, underscores, and periods only."
            autoComplete="username"
            value={username}
            onChange={(e) => {
              setUsernameInput(e.target.value);
              setFieldError(null);
            }}
            onInvalid={handleInvalid}
            aria-describedby={fieldError ? "username-error" : undefined}
            className={fieldError ? authFieldErrorClass : authFieldClass}
          />
          <AuthFieldError id="username-error" message={fieldError} />

          <button
            type="submit"
            disabled={submitting}
            className={`${authSubmitClass} mt-6`}
            style={{ backgroundColor: GOLD, color: INK }}
          >
            {submitting ? "…" : "Continue"}
          </button>
        </form>
      </AuthCard>
    </AuthStage>
  );
}
