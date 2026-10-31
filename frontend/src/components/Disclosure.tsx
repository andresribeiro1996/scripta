import type { ReactNode } from "react";

export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-t border-(--color-border)">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {title}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-(--color-text-dim) group-open:rotate-45 motion-safe:transition-transform motion-safe:duration-150">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}
