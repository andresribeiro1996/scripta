import { usernameHint } from "@scripta/shared";
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
  authHintClass,
  authLabelClass,
  authSubmitClass
} from "../auth/AuthStage";
import { useLocale, useT } from "../i18n";

/** Where a Google sign-in without a username yet gets routed (see
 *  RequireUsername). Not shown to password-signup accounts — they pick a
 *  username at signup time and never have a null one to begin with. */
export function ChooseUsernamePage() {
  const locale = useLocale();
  const t = useT();
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
      setError(err instanceof Error ? err.message : t("shell.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthStage>
      <AuthCard>
        <AuthHeading
          title={t("shell.oneMoreThing")}
          subtitle={t("shell.chooseUsernameSubtitle", { email: session.user.email })}
        />

        <AuthServerError message={error} />

        <form onSubmit={handleSubmit}>
          <label className={authLabelClass} htmlFor="username">
            {t("shell.username")}
          </label>
          <input
            id="username"
            type="text"
            required
            minLength={3}
            maxLength={30}
            pattern="[a-zA-Z0-9_.]+"
            title={t("shell.usernameRule")}
            autoComplete="username"
            value={username}
            onChange={(e) => {
              setUsernameInput(e.target.value);
              setFieldError(null);
            }}
            onInvalid={handleInvalid}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? "username-error" : "username-hint"}
            className={authFieldClass}
          />
          {fieldError ? <AuthFieldError id="username-error" message={fieldError} /> : <p id="username-hint" className={authHintClass}>{usernameHint(locale)}</p>}

          <button type="submit" disabled={submitting} className={`${authSubmitClass} mt-6`}>
            {submitting ? t("shell.saving") : t("shell.continue")}
          </button>
        </form>
      </AuthCard>
    </AuthStage>
  );
}
