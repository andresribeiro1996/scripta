import { USERNAME_HINT } from "@scripta/shared";
import { afterSignIn, getAuthReturnTo, startAuthNavigation } from "../auth/returnTo";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
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
  authSubmitClass
} from "../auth/AuthStage";

/** Where a Google sign-in without a username yet gets routed (see
 *  RequireUsername). Not shown to password-signup accounts — they pick a
 *  username at signup time and never have a null one to begin with. */
export function ChooseUsernamePage() {
  const { session, setUsername } = useAuth();
  const navigate = useNavigate();
  const [username, setUsernameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!session) return <Navigate to="/login" replace />;
  if (session.user.username) return <Navigate to={afterSignIn(session.user.username)} replace />;

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
      startAuthNavigation(getAuthReturnTo(), true);
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
        <AuthHeading
          title="One more thing"
          subtitle={`Choose a username for ${session.user.email}. You'll be able to log in with it or your email from now on.`}
        />

        <AuthServerError message={error} />

        <form onSubmit={handleSubmit}>
          <label className={authLabelClass} htmlFor="username">
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
          <p className={authHintClass}>{USERNAME_HINT}</p>
          <AuthFieldError id="username-error" message={fieldError} />

          <button type="submit" disabled={submitting} className={`${authSubmitClass} mt-6`}>
            {submitting ? "Saving…" : "Continue"}
          </button>
        </form>
      </AuthCard>
    </AuthStage>
  );
}
