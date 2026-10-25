import { createContext, useContext, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { activeTabTo, type AreaTab } from "../../lib/areas";
import { DEFAULT_LIBRARY_STYLE } from "../../lib/libraryStyle";
import { ChevronLeftIcon } from "../Toolbar";

export const PageWidthContext = createContext<number>(DEFAULT_LIBRARY_STYLE.contentMaxWidth);

export function Page({ title, subtitle, back, actions, tabs, maxWidth, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  tabs?: readonly AreaTab[];
  maxWidth?: number;
  children: ReactNode;
}) {
  const location = useLocation();
  const contextWidth = useContext(PageWidthContext);
  const style = { maxWidth: `${maxWidth ?? contextWidth}px` };
  const activeTo = tabs?.length ? activeTabTo(tabs, location) : null;
  return (
    <>
      <header className="border-b border-(--color-border) bg-(--color-surface)">
        <div className="mx-auto px-4 pt-3 sm:px-5" style={style}>
          {back ? (
            <Link to={back.to} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-(--color-text-dim) hover:text-(--color-text)">
              <ChevronLeftIcon />{back.label}
            </Link>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pb-3">
            <div className="min-w-0 flex-1 basis-60 sm:basis-40">
              <h1 className="font-display min-w-0 font-bold break-words text-2xl sm:text-3xl">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-(--color-text-dim)">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
          {tabs?.length ? (
            <nav aria-label="Sections" className="-mx-4 flex overflow-x-auto px-4 sm:mx-0 sm:px-0">
              {tabs.map((tab) => {
                const active = tab.to === activeTo;
                return (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold ${active ? "border-(--color-accent) text-(--color-text)" : "border-transparent text-(--color-text-dim) hover:text-(--color-text)"}`}
                  >{tab.label}</Link>
                );
              })}
            </nav>
          ) : null}
        </div>
      </header>
      <div className="mx-auto px-4 py-5 sm:px-5 sm:py-8" style={style}>{children}</div>
    </>
  );
}
