import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "./Toolbar";

export interface ToastOptions {
  message: string;
  kind?: "info" | "error";
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  kind: "info" | "error";
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message: options.message, kind: options.kind ?? "info", action: options.action }]);
      window.setTimeout(() => dismiss(id), options.duration ?? 5000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 lg:bottom-4">
        {toasts.map((t) => {
          const action = t.action;
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
                t.kind === "error"
                  ? "border-(--color-danger-soft) bg-(--color-danger-soft) text-(--color-danger)"
                  : "border-(--color-border) bg-(--color-surface) text-(--color-text)"
              }`}
            >
              {/* Both controls carry negative margins against padding so
                  they reach 44px of touch target without making the toast
                  any taller than the text needs. An "Undo" you have to aim
                  at is not an undo — the plain text button measured 48x19,
                  and Undo is the affordance a mis-tapped Delete depends
                  on. */}
              <span className="flex-1 self-center">{t.message}</span>
              {action && (
                <button
                  onClick={() => {
                    action.onClick();
                    dismiss(t.id);
                  }}
                  className="-my-2 inline-flex min-h-11 items-center px-1 font-semibold text-(--color-accent) hover:opacity-80"
                >
                  {action.label}
                </button>
              )}
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-my-2 inline-flex min-h-11 items-center px-1 text-(--color-text-dim) hover:text-(--color-text)">
                <CloseIcon size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (options: ToastOptions) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
