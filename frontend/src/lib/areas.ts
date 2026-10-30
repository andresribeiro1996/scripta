export type AreaId = "home" | "library" | "murals" | "games" | "readerCard" | "community" | "settings" | "admin";
export interface AreaTab { label: string; to: string }
export interface Area { id: AreaId; label: string; to: string; tabs: readonly AreaTab[]; description?: string }

export const AREAS: readonly Area[] = [
  { id: "home", label: "Home", to: "/dashboard", tabs: [] },
  {
    id: "library",
    label: "Library",
    to: "/dashboard/library",
    tabs: [
      { label: "Books", to: "/dashboard/library" },
      { label: "Series", to: "/dashboard/series" },
      { label: "Collections", to: "/dashboard/collections" },
      { label: "Gallery", to: "/dashboard/gallery" }
    ]
  },
  { id: "murals", label: "Murals", to: "/dashboard/murals", tabs: [], description: "Freeform dashboard pages" },
  {
    id: "games",
    label: "Games",
    to: "/dashboard/arena",
    tabs: [
      { label: "Tier lists", to: "/dashboard/arena?tab=tierlists" },
      { label: "Quizzes", to: "/dashboard/arena?tab=quizzes" },
      { label: "Tournaments", to: "/dashboard/arena" }
    ],
    description: "Book-bracket tournaments"
  },
  { id: "readerCard", label: "Reader card", to: "/dashboard/reader-card", tabs: [] },
  {
    id: "community",
    label: "Community",
    to: "/community/discover",
    tabs: [
      { label: "Discover", to: "/community/discover" },
      { label: "People", to: "/community/people" }
    ]
  },
  {
    id: "settings",
    label: "Settings",
    to: "/dashboard/settings",
    tabs: [
      { label: "Account", to: "/dashboard/settings" },
      { label: "Appearance", to: "/dashboard/settings/appearance" },
      { label: "Library style", to: "/dashboard/style" }
    ]
  },
  {
    id: "admin",
    label: "Admin",
    to: "/admin/genres",
    tabs: [
      { label: "Daily chapter", to: "/admin/daily-chapter" }, { label: "Genres", to: "/admin/genres" },
      { label: "Synopses", to: "/admin/synopses" },
      { label: "Translations", to: "/admin/translations" }
    ]
  }
];

export function area(id: AreaId): Area {
  const found = AREAS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown area ${id}`);
  return found;
}

export const NAV_AREAS: readonly Area[] = AREAS.filter((a) => a.id !== "admin");

export const TOP_BAR_AREAS: readonly Area[] = NAV_AREAS.filter((a) => a.id !== "settings");

export function footerAreas(isAdmin: boolean): Area[] {
  return isAdmin ? [area("admin")] : [];
}

export const BOTTOM_BAR_AREAS: readonly AreaId[] = ["home", "library", "murals", "games"];

const PREFIXES: ReadonlyArray<[string, AreaId]> = [
  ["/dashboard/saved", "home"],
  ["/dashboard/library", "library"],
  ["/dashboard/series", "library"],
  ["/dashboard/collections", "library"],
  ["/dashboard/gallery", "library"],
  ["/work", "library"],
  ["/book", "library"],
  ["/dashboard/murals", "murals"],
  ["/dashboard/arena", "games"],
  ["/arena", "games"],
  ["/dashboard/reader-card", "readerCard"],
  ["/community", "community"],
  ["/dashboard/settings", "settings"],
  ["/dashboard/style", "settings"],
  ["/admin", "admin"]
];

function trimSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function areaIdForPath(rawPath: string): AreaId | null {
  const pathname = trimSlash(rawPath);
  if (pathname === "/dashboard") return "home";
  for (const [prefix, id] of PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id;
  }
  return null;
}

export function activeTabTo(tabs: readonly AreaTab[], location: { pathname: string; search: string }): string | null {
  const pathname = trimSlash(location.pathname);
  const wanted = new URLSearchParams(location.search).get("tab");
  let plain: string | null = null;
  for (const tab of tabs) {
    const [path, query] = tab.to.split("?");
    if (path !== pathname) continue;
    const tabParam = query ? new URLSearchParams(query).get("tab") : null;
    if (tabParam === null) plain ??= tab.to;
    else if (tabParam === wanted) return tab.to;
  }
  return plain;
}

export type BackKind = "tierlist" | "quiz" | "tournament" | "mural" | "book" | "profile";

export function backTo(kind: BackKind): { to: string; label: string } {
  switch (kind) {
    case "tierlist": return { to: "/dashboard/arena?tab=tierlists", label: "Games" };
    case "quiz": return { to: "/dashboard/arena?tab=quizzes", label: "Games" };
    case "tournament": return { to: "/dashboard/arena", label: "Games" };
    case "mural": return { to: "/dashboard/murals", label: "Murals" };
    case "book": return { to: "/dashboard/library", label: "Library" };
    case "profile": return { to: "/community/discover", label: "Community" };
  }
}
