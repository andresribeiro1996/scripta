import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useLocation } from "react-router-dom";
import { newCountLabel } from "@scripta/shared";
import { fetchIsAdmin } from "../api/books";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Avatar";
import { BrandLockup } from "../components/BrandLockup";
import { MoreIcon } from "../components/NavIcons";
import { PageWidthContext } from "../components/page/Page";
import { AREA_ICONS, SidebarNav } from "../components/page/SidebarNav";
import { OfflineBanner } from "../components/OfflineBanner";
import { useAccountAppearanceSync } from "../hooks/useAccountAppearanceSync";
import { useDashboard } from "../hooks/useDashboard";
import { useDismissible } from "../hooks/useDismissible";
import { useGenreEnrichment } from "../hooks/useGenreEnrichment";
import { useLibrary } from "../hooks/useLibrary";
import { useScrollLock } from "../hooks/useScrollLock";
import { area, areaIdForPath, BOTTOM_BAR_AREAS, footerAreas, NAV_AREAS } from "../lib/areas";
import { resolveLibraryStyle } from "../lib/libraryStyle";

/** Persistent left-hand nav wrapping every signed-in page (every area in lib/areas.ts) — one shared shell instead of each page
 *  reimplementing its own header/logout, which is how it worked before
 *  this existed (see git history on DashboardPage.tsx). */
export function DashboardLayout() {
  const { session, logout } = useAuth();
  const { data: library, updateLibrary } = useLibrary();
  const { personalNewCount } = useDashboard();
  useGenreEnrichment(library?.data.books ?? [], library?.genres, updateLibrary);
  useAccountAppearanceSync();
  const { data: isAdmin = false } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity, enabled: Boolean(session) });
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Set by the mural editor while it's in edit mode: the canvas is the
  // whole activity then, and the fixed bottom nav both covers it and
  // spends 3.5rem of a phone's height. View mode keeps the nav — a
  // mural being looked at is still just another page.
  const [navHidden, setNavHidden] = useState(false);
  // Always-mounted layout — lock only while the nav drawer is open, or
  // the app would never scroll at all.
  useScrollLock(drawerOpen);

  useDismissible(() => setDrawerOpen(false), drawerOpen);

  const activeId = areaIdForPath(useLocation().pathname);
  const homeBadge = newCountLabel(personalNewCount);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface) px-3 py-5 lg:flex">
        <BrandLockup className="mb-6 px-2" />
        <nav className="flex flex-1 flex-col gap-1">
          <SidebarNav areas={NAV_AREAS} activeId={activeId} homeBadge={homeBadge} />
        </nav>
        <div className="mt-auto border-t border-(--color-border) pt-3">
          <div className="mb-2 flex items-center gap-2 px-2">
            {session && (
              <Link to={`/community/u/${session.user.username}`} aria-label="My shelf" title="My shelf" className="shrink-0 rounded-full transition-opacity hover:opacity-80">
                <Avatar user={session.user} size={24} />
              </Link>
            )}
            <p className="truncate text-xs text-(--color-text-dim)">@{session?.user.username ?? session?.user.email}</p>
          </div>
          <div className={isAdmin ? "mb-2" : undefined}><SidebarNav areas={footerAreas(isAdmin)} activeId={activeId} /></div>
          <button
            onClick={() => void logout()}
            className="w-full rounded-lg border border-(--color-danger-soft) min-h-11 px-3 py-2.5 text-left text-sm text-(--color-danger) hover:bg-(--color-danger-soft)"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* No user background color here on purpose. This element wraps the
          ENTIRE signed-in app — every route, the page headers, the
          toolbars — so painting the Library style's `backgroundColor` on
          it meant one library setting recolored Settings, Library style,
          Gallery and Murals too, and stranded the header's
          `--color-text` title on an arbitrary color. That background now
          belongs to LibraryCanvas, which wraps only the book grid; see
          its comment for the whole boundary. */}
      <main className={`min-w-0 flex-1 ${navHidden ? "lg:pb-0" : "pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0"}`}>
        <OfflineBanner />
        <PageWidthContext.Provider value={resolveLibraryStyle(library?.data.style).contentMaxWidth}>
          <Outlet context={{ setNavHidden }} />
        </PageWidthContext.Provider>
      </main>

      {!navHidden && (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom,0px)] lg:hidden">
          {BOTTOM_BAR_AREAS.map((id) => {
            const item = area(id);
            const Icon = AREA_ICONS[id];
            return (
              <Link
                key={id}
                to={item.to}
                aria-current={id === activeId ? "page" : undefined}
                aria-label={id === "home" && homeBadge ? `Home, ${homeBadge} new` : undefined}
                className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                  id === activeId ? "text-(--color-accent)" : "text-(--color-text-dim)"
                }`}
              >
                <span className="relative">
                  <Icon size={22} />
                  {id === "home" && homeBadge && (
                    <span className="absolute -top-1 left-1/2 rounded-full bg-(--color-accent) px-1.5 text-[10px] font-bold text-(--color-on-accent)">{homeBadge}</span>
                  )}
                </span>
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              drawerOpen ? "text-(--color-accent)" : "text-(--color-text-dim)"
            }`}
          >
            <MoreIcon size={22} />
            More
          </button>
        </nav>
      )}

      {drawerOpen && (
        <div className="drawer-in fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setDrawerOpen(false)}>
          <aside
            className="flex h-full w-72 max-w-[85%] flex-col overflow-y-auto overscroll-contain border-r border-(--color-border) bg-(--color-surface) px-3 py-5 pb-[env(safe-area-inset-bottom,0px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <BrandLockup className="mb-6 px-2" />
            <nav className="flex flex-1 flex-col gap-1">
              <SidebarNav areas={NAV_AREAS} activeId={activeId} homeBadge={homeBadge} onNavigate={() => setDrawerOpen(false)} withDescriptions />
            </nav>
            <div className="mt-6 border-t border-(--color-border) pt-3">
              <div className="mb-2 flex items-center gap-2 px-2">
                {session && (
                  <Link
                    to={`/community/u/${session.user.username}`}
                    aria-label="My shelf"
                    title="My shelf"
                    onClick={() => setDrawerOpen(false)}
                    className="shrink-0 rounded-full transition-opacity hover:opacity-80"
                  >
                    <Avatar user={session.user} size={24} />
                  </Link>
                )}
                <p className="truncate text-xs text-(--color-text-dim)">@{session?.user.username ?? session?.user.email}</p>
              </div>
              <div className={isAdmin ? "mb-2" : undefined}><SidebarNav areas={footerAreas(isAdmin)} activeId={activeId} onNavigate={() => setDrawerOpen(false)} /></div>
              <button
                onClick={() => void logout()}
                className="w-full rounded-lg border border-(--color-danger-soft) min-h-11 px-3 py-2.5 text-left text-sm text-(--color-danger) hover:bg-(--color-danger-soft)"
              >
                Log out
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
