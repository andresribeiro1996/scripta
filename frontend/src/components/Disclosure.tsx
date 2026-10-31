import type { ReactNode } from "react";

export function Disclosure({ title, children, page = false }: { title: string; children: ReactNode; page?: boolean }) {
  const row = (
    <>
      {title}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-(--color-text-dim) group-open:rotate-45 motion-safe:transition-transform motion-safe:duration-150">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </>
  );
  return (
    <details className={`group border-(--color-border) ${page ? "border-b" : "border-t"}`}>
      {page ? (
        <summary className="cursor-pointer list-none rounded-sm [&::-webkit-details-marker]:hidden">
          <h2 className="flex min-h-14 items-center justify-between gap-4 py-4 font-sans text-base font-normal">{row}</h2>
        </summary>
      ) : (
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">{row}</summary>
      )}
      <div className={page ? "space-y-3 pb-6 text-pretty text-sm leading-relaxed text-(--color-text-dim) [&_b]:font-medium [&_b]:text-(--color-text) [&_li]:mt-2 [&_ul]:list-disc [&_ul]:pl-5" : "pb-3"}>{children}</div>
    </details>
  );
}
