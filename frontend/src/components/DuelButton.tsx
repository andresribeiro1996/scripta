import type { ReactNode } from "react";

export function DuelButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-16 flex-1 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-center text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-50">
      {children}
    </button>
  );
}
