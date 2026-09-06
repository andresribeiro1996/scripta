import { useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Avatar";
import { SocialsSection } from "../components/SocialsSection";

export function SettingsPage() {
  const { session, setUsername, uploadAvatar, removeAvatar } = useAuth();
  const [draft, setDraft] = useState(session?.user.username ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setSuccess(false);
    setAvatarBusy(true);
    try {
      await uploadAvatar(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    setError(null);
    setSuccess(false);
    setAvatarBusy(true);
    try {
      await removeAvatar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await setUsername(draft);
      setEditing(false);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-8">
      <h2 className="mb-6 text-lg font-bold">Settings</h2>

      <section className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
        <h3 className="mb-4 text-sm font-semibold">Account</h3>

        {session && (
          <div className="mb-4 flex items-center gap-3">
            <Avatar user={session.user} size={48} className={avatarBusy ? "animate-pulse" : ""} />
            <div>
              <div className="mb-0.5 text-xs text-(--color-text-dim)">Profile picture</div>
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
                <button
                  disabled={avatarBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-(--color-accent) transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  {avatarBusy ? "Working…" : "Change"}
                </button>
                {session.user.avatarId && (
                  <button
                    disabled={avatarBusy}
                    onClick={() => void handleAvatarRemove()}
                    className="text-xs text-(--color-text-dim) transition-opacity hover:opacity-80 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="mb-1 text-xs text-(--color-text-dim)">Email</div>
          <div className="text-sm">{session?.user.email}</div>
        </div>

        <div>
          <div className="mb-1 text-xs text-(--color-text-dim)">Username</div>
          {!editing ? (
            <div className="flex items-center gap-3">
              <span className="text-sm">@{session?.user.username ?? "—"}</span>
              <button
                onClick={() => {
                  setEditing(true);
                  setDraft(session?.user.username ?? "");
                  setError(null);
                  setSuccess(false);
                }}
                className="text-xs text-(--color-accent) transition-opacity hover:opacity-80"
              >
                Change
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                minLength={3}
                maxLength={30}
                pattern="[a-zA-Z0-9_.]+"
                title="Letters, numbers, underscores, and periods only."
                className="w-48 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-sm text-(--color-text-dim) hover:text-(--color-text)"
              >
                Cancel
              </button>
            </form>
          )}
          {error && <p className="mt-2 text-xs text-(--color-danger)">{error}</p>}
          {success && <p className="mt-2 text-xs text-(--color-accent)">Username updated.</p>}
        </div>
      </section>

      <SocialsSection />
    </div>
  );
}
