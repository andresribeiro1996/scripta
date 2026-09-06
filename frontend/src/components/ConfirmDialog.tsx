import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useDismissible } from "../hooks/useDismissible";
import { useScrollLock } from "../hooks/useScrollLock";

interface ConfirmOptions {
  /** Short question, e.g. `Delete "My Series"?` — rendered like
   *  CoverPickerModal's own modal heading. */
  title: string;
  /** Optional supporting detail below the title, e.g. "This can't be
   *  undone." — rendered like CoverPickerModal's own modal subtitle. */
  body?: string;
  /** Defaults to "Delete" — every call site this replaced was a delete
   *  confirmation, so that's the sensible default rather than something
   *  every caller has to repeat. */
  confirmLabel?: string;
  /** Defaults to true (the confirm button uses --color-danger, same red
   *  every destructive action in this app already uses — the book-delete
   *  toolbar button, "Remove custom cover", etc.). Set false for a
   *  confirmation that isn't actually destructive. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface ConfirmContextValue {
  /** Replaces `window.confirm` — same "returns whether the user
   *  confirmed" shape, just async (a real modal can't block like the
   *  native dialog did), so call sites become `if (!(await confirm(...)))
   *  return;` instead of `if (!window.confirm(...)) return;`. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Always-mounted provider — lock only while a dialog is actually up.
  useScrollLock(pending !== null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function settle(confirmed: boolean) {
    pending?.resolve(confirmed);
    setPending(null);
  }

  // Focus the Cancel button, not Confirm, the moment the dialog opens —
  // every one of these is a destructive/delete confirmation, so a stray
  // Enter press (the same key that would advance a native browser
  // confirm()) should be the safe outcome, not the destructive one.
  useEffect(() => {
    if (pending) cancelButtonRef.current?.focus();
  }, [pending]);

  useDismissible(() => settle(false), pending !== null);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        // Same fixed-overlay modal shell as CoverPickerModal.tsx / the
        // mural pickers — bg-black/40 backdrop, click-outside-to-close
        // (here: cancel) via the inner panel's stopPropagation.
        <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => settle(false)}>
          <div
            className="w-full max-w-sm rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
          >
            <h3 id="confirm-dialog-title" className="text-sm font-semibold">
              {pending.title}
            </h3>
            {pending.body && <p className="mt-1.5 text-xs text-(--color-text-dim)">{pending.body}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelButtonRef}
                onClick={() => settle(false)}
                className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5 text-sm font-semibold hover:bg-(--color-surface-hover)"
              >
                Cancel
              </button>
              <button
                onClick={() => settle(true)}
                className={
                  pending.danger === false
                    ? "rounded-lg bg-(--color-accent) px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                    : "rounded-lg bg-(--color-danger) px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                }
              >
                {pending.confirmLabel ?? "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx.confirm;
}
