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
      {title != null && (
        <header className="border-b border-(--color-border) bg-(--color-surface)">
          <div className="mx-auto flex min-h-20 items-center gap-4 px-4 py-3 sm:px-5 lg:px-8" style={{ maxWidth: `${contextWidth}px` }}>
            {back ? (
              <Link to={back.to} className="-ml-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-(--color-text-dim) hover:text-(--color-text)">
                <ChevronLeftIcon />{back.label}
              </Link>
            ) : null}
            <h1 className="font-display min-w-0 flex-1 font-bold break-words text-2xl sm:text-3xl">{title}</h1>
          </div>
        </header>
      )}
      <div className="mx-auto px-4 py-5 sm:px-5 sm:py-8 lg:px-8" style={style}>
        {subtitle || actions ? (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            {subtitle ? <div className="min-w-0 text-sm text-(--color-text-dim)">{subtitle}</div> : null}
            {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {tabs?.length ? (
          <nav aria-label="Sections" className="-mx-4 mb-6 flex overflow-x-auto border-b border-(--color-border) px-4 sm:mx-0 sm:px-0">
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
        {children}
      </div>
    </>
  );
}
