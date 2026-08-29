import { useEffect, useRef, useState } from "react";
import { ApiError, postToSocial, type SocialProvider } from "../api/socials";
import { useSocials } from "../hooks/useSocials";
import { useConfirm } from "./ConfirmDialog";
import { SocialIcon } from "./icons/SocialIcons";

type Platform = Extract<SocialProvider, "x" | "threads">;

const PLATFORM_LABELS: Record<Platform, string> = { x: "X", threads: "Threads" };

/** The one modal every "Share" entry point in the app opens — a mural
 *  card's OptionsMenu, MuralEditorPage's header, and LibraryPage's
 *  page-level Share button (see each page's own wiring). Deliberately
 *  generic over WHAT is being shared (a `title` string plus a share-
 *  token/url pair and a pair of async share/unshare callbacks) rather than
 *  taking a whole mural or library object — same "what am I sharing" split
 *  CoverPickerModal.tsx already draws for covers, since a mural and a
 *  library document share nothing in common except this exact
 *  shareToken/shareUrl shape (lib/murals.ts's Mural, api/library.ts's
 *  LibraryDocument).
 *
 *  Same fixed-overlay modal shell as ConfirmDialog.tsx/CoverPickerModal.tsx
 *  (bg-black/40 backdrop, click-outside-to-close via the inner panel's own
 *  stopPropagation, Escape-to-close).
 *
 *  Local state carries the shared/not-shared view instead of waiting for
 *  the parent's own re-render — onShare/onUnshare already hand back
 *  everything needed to flip the view immediately, and the parent's own
 *  cache update (useMurals()/useLibrary()) will keep the prop in sync for
 *  any later remount anyway. */
export function ShareModal({
  title,
  shareToken,
  shareUrl,
  defaultCaption,
  onShare,
  onUnshare,
  onClose
}: {
  title: string;
  shareToken: string | null;
  shareUrl: string | null;
  defaultCaption: string;
  onShare: () => Promise<{ shareToken: string; shareUrl: string }>;
  onUnshare: () => Promise<void>;
  onClose: () => void;
}) {
  const { data: socials } = useSocials();
  const confirm = useConfirm();

  const [current, setCurrent] = useState<{ shareToken: string; shareUrl: string } | null>(
    shareToken && shareUrl ? { shareToken, shareUrl } : null
  );
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [unsharing, setUnsharing] = useState(false);
  const [unshareError, setUnshareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [composing, setComposing] = useState<Platform | null>(null);
  const [composeText, setComposeText] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<{ postUrl?: string } | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleShare() {
    setShareError(null);
    setSharing(true);
    try {
      const result = await onShare();
      setCurrent(result);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Couldn't create a share link.");
    } finally {
      setSharing(false);
    }
  }

  async function handleCopy() {
    if (!current) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(current.shareUrl);
      setCopied(true);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Couldn't copy that — try selecting and copying the link manually.");
    }
  }

  function handleNativeShare() {
    if (!current) return;
    void navigator.share({ title, url: current.shareUrl });
  }

  function openCompose(platform: Platform) {
    if (!current) return;
    setComposing(platform);
    setComposeText(`${defaultCaption}\n\n${current.shareUrl}`);
    setPostError(null);
    setPostSuccess(null);
  }

  function closeCompose() {
    setComposing(null);
    setPostError(null);
    setPostSuccess(null);
  }

  async function handlePost() {
    if (!composing) return;
    setPosting(true);
    setPostError(null);
    setPostSuccess(null);
    try {
      const result = await postToSocial(composing, composeText);
      setPostSuccess(result);
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : "Couldn't post that — try again.");
    } finally {
      setPosting(false);
    }
  }

  async function handleStopSharing() {
    if (
      !(await confirm({
        title: "Stop sharing this link?",
        body: "Anyone who already has the link will lose access to it.",
        confirmLabel: "Stop sharing"
      }))
    ) {
      return;
    }
    setUnshareError(null);
    setUnsharing(true);
    try {
      await onUnshare();
      setCurrent(null);
    } catch (err) {
      setUnshareError(err instanceof ApiError ? err.message : "Couldn't stop sharing — try again.");
    } finally {
      setUnsharing(false);
    }
  }

  const canNativeShare = typeof navigator.share === "function";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Share "{title}"</h3>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        {!current && (
          <div>
            <p className="mb-4 text-sm text-(--color-text-dim)">
              Create a public link anyone can view — no account needed on their end.
            </p>
            <button
              onClick={() => void handleShare()}
              disabled={sharing}
              className="rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {sharing ? "Creating…" : "Create share link"}
            </button>
            {shareError && <p className="mt-2 text-xs text-(--color-danger)">{shareError}</p>}
          </div>
        )}

        {current && (
          <div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={current.shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
              />
              <button
                onClick={() => void handleCopy()}
                className="shrink-0 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover)"
              >
                Copy link
              </button>
            </div>
            {copied && <p className="mt-1.5 text-xs text-(--color-accent)">Copied!</p>}
            {copyError && <p className="mt-1.5 text-xs text-(--color-danger)">{copyError}</p>}

            {canNativeShare && (
              <button
                onClick={handleNativeShare}
                className="mt-3 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover)"
              >
                Share…
              </button>
            )}

            {!composing && (
              <div className="mt-3 flex gap-2">
                {(["x", "threads"] as const).map((platform) => {
                  const status = socials?.find((s) => s.provider === platform);
                  const connected = status?.connected ?? false;
                  return (
                    <button
                      key={platform}
                      onClick={() => openCompose(platform)}
                      disabled={!connected}
                      title={connected ? undefined : `Connect ${PLATFORM_LABELS[platform]} in Settings to share directly.`}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--color-surface)"
                    >
                      <SocialIcon provider={platform} className="h-4 w-4" />
                      {PLATFORM_LABELS[platform]}
                    </button>
                  );
                })}
              </div>
            )}

            {composing && (
              <div className="mt-3">
                <textarea
                  autoFocus
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={closeCompose}
                    disabled={posting}
                    className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handlePost()}
                    disabled={posting || composeText.trim().length === 0}
                    className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {posting ? "Posting…" : `Post to ${PLATFORM_LABELS[composing]}`}
                  </button>
                </div>
                {postError && <p className="mt-2 text-xs text-(--color-danger)">{postError}</p>}
                {postSuccess && (
                  <p className="mt-2 text-xs text-(--color-accent)">
                    Posted to {PLATFORM_LABELS[composing]}!{" "}
                    {postSuccess.postUrl && (
                      <a href={postSuccess.postUrl} target="_blank" rel="noreferrer" className="underline hover:opacity-80">
                        View post
                      </a>
                    )}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 border-t border-(--color-border) pt-3">
              <button
                onClick={() => void handleStopSharing()}
                disabled={unsharing}
                className="text-xs text-(--color-danger) transition-opacity hover:opacity-80 disabled:opacity-60"
              >
                {unsharing ? "Stopping…" : "Stop sharing"}
              </button>
              {unshareError && <p className="mt-1.5 text-xs text-(--color-danger)">{unshareError}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
