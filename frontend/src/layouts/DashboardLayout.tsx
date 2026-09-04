import { Fragment, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { OfflineBanner } from "../components/OfflineBanner";
import { useScrollLock } from "../hooks/useScrollLock";

interface NavItem {
  to: string;
  label: string;
  end: boolean;
  description?: string;
}

const NAV_GROUPS: Array<{ items: NavItem[] }> = [
  {
    items: [
      { to: "/dashboard", label: "Library", end: true },
      { to: "/dashboard/series", label: "Series", end: false },
      { to: "/dashboard/collections", label: "Collections", end: false }
    ]
  },
  {
    items: [
      { to: "/dashboard/gallery", label: "Gallery", end: false },
      { to: "/dashboard/murals", label: "Murals", end: false, description: "Freeform dashboard pages" },
      { to: "/dashboard/arena", label: "Arena", end: false, description: "Book-bracket tournaments" }
    ]
  },
  {
    // "Library style" deliberately isn't here. It styles ONE page's
    // cards and canvas, so it belongs to the Library rather than to the
    // app — it now lives behind that page's own gear, next to the other
    // things you do to your library. The route still exists and is
    // reachable directly; it's only the nav entry that moved, so an old
    // bookmark keeps working.
    items: [{ to: "/dashboard/settings", label: "Settings", end: false }]
  }
];

const TAB_ITEMS = NAV_GROUPS[0].items;

/** Persistent left-hand nav wrapping every signed-in page (Library, Series,
 *  Collections, Settings) — one shared shell instead of each page
 *  reimplementing its own header/logout, which is how it worked before
 *  this existed (see git history on DashboardPage.tsx). */
export function DashboardLayout() {
  const { session, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Set by the mural editor while it's in edit mode: the canvas is the
  // whole activity then, and the fixed bottom nav both covers it and
  // spends 3.5rem of a phone's height. View mode keeps the nav — a
  // mural being looked at is still just another page.
  const [navHidden, setNavHidden] = useState(false);
  // Always-mounted layout — lock only while the nav drawer is open, or
  // the app would never scroll at all.
  useScrollLock(drawerOpen);

  useEffect(() => {
    if (!drawerOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? "bg-(--color-accent-soft) text-(--color-accent)"
        : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
    }`;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface) px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
          <span className="text-lg font-bold">Scripta</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_GROUPS.map((group, groupIndex) => (
            <Fragment key={groupIndex}>
              {groupIndex > 0 && <div className="my-3 border-t border-(--color-border)" />}
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} title={item.description} className={navLinkClass}>
                  {item.label}
                </NavLink>
              ))}
            </Fragment>
          ))}
        </nav>
        <div className="mt-auto border-t border-(--color-border) pt-3">
          <p className="mb-2 truncate px-2 text-xs text-(--color-text-dim)">@{session?.user.username ?? session?.user.email}</p>
          <button
            onClick={() => void logout()}
            className="w-full rounded-lg border border-(--color-danger-soft) px-3 py-2.5 text-left text-sm text-(--color-danger) hover:bg-(--color-danger-soft)"
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
        <Outlet context={{ setNavHidden }} />
      </main>

      {!navHidden && (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom,0px)] lg:hidden">
          {TAB_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex h-14 flex-1 items-center justify-center text-[13px] font-medium ${
                  isActive ? "text-(--color-accent)" : "text-(--color-text-dim)"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            className={`h-14 flex-1 text-[13px] font-medium ${drawerOpen ? "text-(--color-accent)" : "text-(--color-text-dim)"}`}
          >
            More
          </button>
        </nav>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setDrawerOpen(false)}>
          <aside
            className="flex h-full w-72 max-w-[85%] flex-col overflow-y-auto overscroll-contain border-r border-(--color-border) bg-(--color-surface) px-3 py-5 pb-[env(safe-area-inset-bottom,0px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center gap-2 px-2">
              <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
              <span className="text-lg font-bold">Scripta</span>
            </div>
            <nav className="flex flex-1 flex-col gap-1">
              {NAV_GROUPS.map((group, groupIndex) => (
                <Fragment key={groupIndex}>
                  {groupIndex > 0 && <div className="my-3 border-t border-(--color-border)" />}
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={navLinkClass}
                      onClick={() => setDrawerOpen(false)}
                    >
                      {item.label}
                      {item.description && (
                        <span className="block text-xs font-normal text-(--color-text-dim)">{item.description}</span>
                      )}
                    </NavLink>
                  ))}
                </Fragment>
              ))}
            </nav>
            <div className="mt-6 border-t border-(--color-border) pt-3">
              <p className="mb-2 truncate px-2 text-xs text-(--color-text-dim)">@{session?.user.username ?? session?.user.email}</p>
              <button
                onClick={() => void logout()}
                className="w-full rounded-lg border border-(--color-danger-soft) px-3 py-2.5 text-left text-sm text-(--color-danger) hover:bg-(--color-danger-soft)"
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
