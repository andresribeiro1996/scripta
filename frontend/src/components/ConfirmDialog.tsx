import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "./page/buttonClasses";
import { Sheet } from "./Sheet";

interface ConfirmOptions {
  /** Short question, e.g. `Delete "My Series"?` — the dialog's title. */
  title: string;
  /** Optional supporting detail below the title, e.g. "This can't be
   *  undone." */
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
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();

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

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <Sheet
          title={pending.title}
          role="alertdialog"
          aria-describedby={pending.body ? bodyId : undefined}
          onClose={() => settle(false)}
          footer={
            <>
              <button ref={cancelButtonRef} onClick={() => settle(false)} className={BUTTON_SECONDARY}>
                Cancel
              </button>
              <button
                onClick={() => settle(true)}
                className={
                  pending.danger === false
                    ? BUTTON_PRIMARY
                    : "inline-flex min-h-11 items-center justify-center rounded-lg bg-(--color-danger) px-4 text-sm font-semibold text-(--color-on-danger) hover:opacity-90"
                }
              >
                {pending.confirmLabel ?? "Delete"}
              </button>
            </>
          }
        >
          {pending.body && <p id={bodyId} className="px-2 pb-2 text-sm text-(--color-text-dim)">{pending.body}</p>}
        </Sheet>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx.confirm;
}
