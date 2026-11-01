import { t } from "../i18n";

export type AreaId = "home" | "library" | "murals" | "games" | "readerCard" | "community" | "settings" | "admin";
export interface AreaTab { readonly label: string; to: string }
export interface Area { id: AreaId; readonly label: string; to: string; tabs: readonly AreaTab[]; readonly description?: string }

export const AREAS: readonly Area[] = [
  { id: "home", get label() { return t("shell.areaHome"); }, to: "/dashboard", tabs: [] },
  {
    id: "library",
    get label() { return t("shell.areaLibrary"); },
    to: "/dashboard/library",
    tabs: [
      { get label() { return t("shell.tabBooks"); }, to: "/dashboard/library" },
      { get label() { return t("shell.tabSeries"); }, to: "/dashboard/series" },
      { get label() { return t("shell.tabCollections"); }, to: "/dashboard/collections" },
      { get label() { return t("shell.tabGallery"); }, to: "/dashboard/gallery" }
    ]
  },
  { id: "murals", get label() { return t("shell.areaMurals"); }, to: "/dashboard/murals", tabs: [], get description() { return t("shell.areaMuralsDescription"); } },
  {
    id: "games",
    get label() { return t("shell.areaGames"); },
    to: "/dashboard/arena?tab=tierlists",
    tabs: [
      { get label() { return t("shell.tabTierLists"); }, to: "/dashboard/arena?tab=tierlists" },
      { get label() { return t("shell.tabQuizzes"); }, to: "/dashboard/arena?tab=quizzes" },
      { get label() { return t("shell.tabTournaments"); }, to: "/dashboard/arena" }
    ],
    get description() { return t("shell.areaGamesDescription"); }
  },
  { id: "readerCard", get label() { return t("shell.areaReaderCard"); }, to: "/dashboard/reader-card", tabs: [] },
  {
    id: "community",
    get label() { return t("shell.areaCommunity"); },
    to: "/community/discover",
    tabs: [
      { get label() { return t("shell.tabDiscover"); }, to: "/community/discover" },
      { get label() { return t("shell.tabPeople"); }, to: "/community/people" }
    ]
  },
  {
    id: "settings",
    get label() { return t("shell.areaSettings"); },
    to: "/dashboard/settings",
    tabs: [
      { get label() { return t("shell.tabAccount"); }, to: "/dashboard/settings" },
      { get label() { return t("shell.tabAppearance"); }, to: "/dashboard/settings/appearance" },
      { get label() { return t("shell.tabLibraryStyle"); }, to: "/dashboard/style" }
    ]
  },
  {
    id: "admin",
    label: "Admin",
    to: "/admin/daily-chapter",
    tabs: [
      { label: "Daily", to: "/admin/daily-chapter" }, { label: "Genres", to: "/admin/genres" },
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
  ["/daily", "home"],
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
    case "tierlist": return { to: "/dashboard/arena?tab=tierlists", label: t("shell.areaGames") };
    case "quiz": return { to: "/dashboard/arena?tab=quizzes", label: t("shell.areaGames") };
    case "tournament": return { to: "/dashboard/arena", label: t("shell.areaGames") };
    case "mural": return { to: "/dashboard/murals", label: t("shell.areaMurals") };
    case "book": return { to: "/dashboard/library", label: t("shell.areaLibrary") };
    case "profile": return { to: "/community/discover", label: t("shell.areaCommunity") };
  }
}
