import { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  GOLD,
  INK,
  PAPER,
  PAPER_DIM,
  PAPER_FAINT,
  AuthBrandHeading,
  AuthCard,
  AuthServerError,
  AuthStage
} from "../auth/AuthStage";
import { Avatar } from "../components/Avatar";

/** The skippable last step of the signup journey (password signups land
 *  here right after registering; Google signups right after choosing a
 *  username). Deliberately NOT a routing gate like RequireUsername — it's
 *  shown exactly once as part of that journey, never on later logins, and
 *  skipping just means "no avatar yet" (the initial fallback). Settings is
 *  where a picture gets added, changed, or removed afterwards, so no
 *  "dismissed" flag needs persisting anywhere. */
export function WelcomeAvatarPage() {
  const { session, uploadAvatar } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  if (!session) return <Navigate to="/login" replace />;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // re-picking the same file must fire change again
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await uploadAvatar(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploading(false);
    }
  }

  const hasAvatar = Boolean(session.user.avatarId);

  return (
    <AuthStage>
      <AuthCard>
        <AuthBrandHeading subtitle="Make it yours" />

        <h2 className="mb-1 text-center text-lg font-semibold" style={{ color: PAPER }}>
          Add a profile picture
        </h2>
        <p className="mb-6 text-center text-[12px]" style={{ color: PAPER_DIM }}>
          Shown next to your name around the app. You can change it anytime in Settings — or skip this for now.
        </p>

        <div className="mb-6 flex justify-center">
          <Avatar user={session.user} size={96} className={uploading ? "animate-pulse" : ""} />
        </div>

        <AuthServerError message={error} />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="w-full rounded-lg border py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ borderColor: PAPER_FAINT, backgroundColor: "rgba(242, 237, 230, 0.05)", color: PAPER }}
        >
          {uploading ? "Uploading…" : hasAvatar ? "Choose a different photo" : "Choose a photo"}
        </button>

        {/* Both buttons do the same navigation — the only difference is the
            wording, so skipping never feels like a second-class path. */}
        <button
          type="button"
          disabled={uploading}
          onClick={() => navigate("/dashboard", { replace: true })}
          className="mt-3 w-full rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ backgroundColor: GOLD, color: INK }}
        >
          {hasAvatar ? "Continue" : "Skip for now"}
        </button>
      </AuthCard>
    </AuthStage>
  );
}
