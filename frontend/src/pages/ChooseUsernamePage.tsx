import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/** Where a Google sign-in without a username yet gets routed (see
 *  RequireUsername). Not shown to password-signup accounts — they pick a
 *  username at signup time and never have a null one to begin with. */
export function ChooseUsernamePage() {
  const { session, setUsername } = useAuth();
  const navigate = useNavigate();
  const [username, setUsernameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!session) return <Navigate to="/login" replace />;
  if (session.user.username) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await setUsername(username);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5">
      <h1 className="mb-1 text-xl font-bold">One more thing</h1>
      <p className="mb-6 text-sm text-(--color-text-dim)">
        Choose a username for your account ({session.user.email}). You'll be able to log in with either it or your
        email from now on.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-(--color-danger-soft) px-3 py-2 text-sm text-(--color-danger)">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-6 shadow-sm">
        <label className="mb-1 block text-sm text-(--color-text-dim)" htmlFor="username">
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
          onChange={(e) => setUsernameInput(e.target.value)}
          className="mb-4 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-(--color-accent) py-2.5 font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
