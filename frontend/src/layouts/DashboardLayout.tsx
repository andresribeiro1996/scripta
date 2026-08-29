import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";
import { fetchLibrary } from "../api/library";
import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Library", end: true },
  { to: "/dashboard/series", label: "Series", end: false },
  { to: "/dashboard/collections", label: "Collections", end: false },
  { to: "/dashboard/gallery", label: "Gallery", end: false },
  { to: "/dashboard/murals", label: "Murals", end: false },
  { to: "/dashboard/arena", label: "Arena", end: false },
  { to: "/dashboard/style", label: "Library style", end: false },
  { to: "/dashboard/settings", label: "Settings", end: false }
];

/** Persistent left-hand nav wrapping every signed-in page (Library, Series,
 *  Collections, Settings) — one shared shell instead of each page
 *  reimplementing its own header/logout, which is how it worked before
 *  this existed (see git history on DashboardPage.tsx). */
export function DashboardLayout() {
  const { session, logout } = useAuth();
  // Same ["library"] cache LibraryPage/GroupsPage read — this just needs
  // the background color override (lib/libraryStyle.ts), so no extra
  // network round trip in practice, it resolves straight from cache.
  const { data: library } = useQuery({ queryKey: ["library"], queryFn: fetchLibrary });
  const backgroundColor = library?.data.style?.backgroundColor ?? undefined;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface) px-3 py-5">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
          <span className="text-lg font-bold">Scripta</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-(--color-accent-soft) text-(--color-accent)"
                    : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-(--color-border) pt-3">
          <p className="mb-2 truncate px-2 text-xs text-(--color-text-dim)">@{session?.user.username ?? session?.user.email}</p>
          <button
            onClick={() => void logout()}
            className="w-full rounded-lg border border-(--color-danger-soft) px-3 py-2 text-left text-sm text-(--color-danger) hover:bg-(--color-danger-soft)"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1" style={{ backgroundColor }}>
        <Outlet />
      </main>
    </div>
  );
}
