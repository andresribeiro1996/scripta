import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { activeTabTo, type AreaTab } from "../../lib/areas";
import { ChevronLeftIcon } from "../Toolbar";
import { TAB_NAV, tabClass } from "./surfaceClasses";

export const PAGE_WIDTHS = { wide: 1440, default: 1200, narrow: 760 } as const;
export type PageWidth = keyof typeof PAGE_WIDTHS;

export function Page({ title, subtitle, back, actions, tabs, width = "default", maxWidth, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  tabs?: readonly AreaTab[];
  width?: PageWidth;
  maxWidth?: number;
  children: ReactNode;
}) {
  const location = useLocation();
  const tabList = tabs?.length ? tabs : null;
  const activeTo = tabList ? activeTabTo(tabList, location) : null;
  return (
    <div className="px-4 pb-16 sm:px-6 lg:px-8">
      <div className="mx-auto" style={{ maxWidth: maxWidth ?? PAGE_WIDTHS[width] }}>
        {title != null || back ? (
          <header className="pt-8 lg:pt-10">
            {back ? (
              <Link to={back.to} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-(--color-text-dim) hover:text-(--color-text)">
                <ChevronLeftIcon />{back.label}
              </Link>
            ) : null}
            {title != null ? (
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                <div className="min-w-0">
                  <h1 className="font-display break-words text-3xl font-bold lg:text-[2.5rem] lg:leading-[3rem]">{title}</h1>
                  {subtitle ? <div className="mt-1.5 text-sm text-(--color-text-dim)">{subtitle}</div> : null}
                </div>
                {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
              </div>
            ) : null}
            {tabList ? (
              <nav aria-label="Sections" className={`mt-6 ${TAB_NAV}`}>
                {tabList.map((tab) => {
                  const active = tab.to === activeTo;
                  return (
                    <Link
                      key={tab.to}
                      to={tab.to}
                      aria-current={active ? "page" : undefined}
                      className={tabClass(active)}
                    >{tab.label}</Link>
                  );
                })}
              </nav>
            ) : null}
          </header>
        ) : null}
        <div className={tabList ? "pt-6" : "pt-8"}>{children}</div>
      </div>
    </div>
  );
}
