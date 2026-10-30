import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Area, AreaId } from "../../lib/areas";
import { BrandLockup } from "../BrandLockup";

export function TopBar({ areas, activeId, homeBadge, brandTo, end, desktopOnly }: {
  areas: readonly Area[];
  activeId: AreaId | null;
  homeBadge?: string | null;
  brandTo: string;
  end: ReactNode;
  desktopOnly?: boolean;
}) {
  return (
    <header
      data-top-bar
      className={`${desktopOnly ? "hidden lg:block " : ""}z-30 border-b border-(--color-border) bg-(--color-bg)/88 backdrop-blur-md lg:sticky lg:top-0`}
    >
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-40 focus:rounded-lg focus:bg-(--color-surface) focus:px-4 focus:py-2.5 focus:font-semibold"
      >
        Skip to content
      </a>
      <div className="flex h-16 items-center gap-4 px-4 sm:px-6 lg:px-8 xl:gap-7">
        <Link to={brandTo} aria-label="Atmyshelf home" className="inline-flex min-h-11 items-center">
          <BrandLockup />
        </Link>
        {areas.length > 0 && (
          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-0.5">
            {areas.map((item) => {
              const active = item.id === activeId;
              const badge = item.id === "home" ? homeBadge : null;
              return (
                <Link
                  key={item.id}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  aria-label={badge ? `${item.label}, ${badge} new` : undefined}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold xl:px-3.5 ${
                    active
                      ? "bg-(--color-accent-soft) text-(--color-accent)"
                      : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                  }`}
                >
                  {item.label}
                  {badge && (
                    <span className="min-w-5 rounded-full bg-(--color-accent) px-1.5 text-center text-xs font-bold leading-5 text-(--color-on-accent)">{badge}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="ml-auto flex items-center">{end}</div>
      </div>
    </header>
  );
}
