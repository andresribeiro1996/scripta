import assert from "node:assert/strict";
import test from "node:test";
import { activeTabTo, area, areaIdForPath, backTo, BOTTOM_BAR_AREAS, footerAreas, NAV_AREAS, TOP_BAR_AREAS, type AreaId } from "../src/lib/areas.ts";

test("areas come in sidebar order; Admin sits in the footer, for admins only", () => {
  assert.deepEqual(NAV_AREAS.map((a) => a.label), ["Home", "Library", "Murals", "Games", "Reader card", "Community", "Settings"]);
  assert.deepEqual(footerAreas(false), []);
  assert.deepEqual(footerAreas(true).map((a) => [a.label, a.to]), [["Admin", "/admin/genres"]]);
  assert.deepEqual(BOTTOM_BAR_AREAS, ["home", "library", "murals", "games"]);
});

test("the top bar lists every area but Settings and Admin", () => {
  assert.deepEqual(TOP_BAR_AREAS.map((a) => a.id), ["home", "library", "murals", "games", "readerCard", "community"]);
});

test("tabs carry today's routes", () => {
  assert.deepEqual(area("library").tabs.map((t) => [t.label, t.to]), [["Books", "/dashboard/library"], ["Series", "/dashboard/series"], ["Collections", "/dashboard/collections"], ["Gallery", "/dashboard/gallery"]]);
  assert.deepEqual(area("games").tabs.map((t) => [t.label, t.to]), [["Tier lists", "/dashboard/arena?tab=tierlists"], ["Quizzes", "/dashboard/arena?tab=quizzes"], ["Tournaments", "/dashboard/arena"]]);
  assert.deepEqual(area("settings").tabs.map((t) => t.to), ["/dashboard/settings", "/dashboard/settings/appearance", "/dashboard/style"]);
  assert.deepEqual(area("community").tabs.map((t) => t.to), ["/community/discover", "/community/people"]);
  assert.deepEqual(area("admin").tabs.map((t) => t.to), ["/admin/daily-chapter", "/admin/genres", "/admin/synopses", "/admin/translations"]);
  assert.deepEqual([area("home").tabs, area("murals").tabs, area("readerCard").tabs], [[], [], []]);
});

test("the active tab follows path and ?tab=, unknown tabs fall back to the plain path", () => {
  const games = area("games").tabs;
  assert.equal(activeTabTo(games, { pathname: "/dashboard/arena", search: "" }), "/dashboard/arena");
  assert.equal(activeTabTo(games, { pathname: "/dashboard/arena", search: "?tab=quizzes" }), "/dashboard/arena?tab=quizzes");
  assert.equal(activeTabTo(games, { pathname: "/dashboard/arena/", search: "?tab=quizzes" }), "/dashboard/arena?tab=quizzes");
  assert.equal(activeTabTo(games, { pathname: "/dashboard/arena", search: "?tab=bogus" }), "/dashboard/arena");
  assert.equal(activeTabTo(area("settings").tabs, { pathname: "/dashboard/style", search: "" }), "/dashboard/style");
  assert.equal(activeTabTo(area("library").tabs, { pathname: "/dashboard/murals", search: "" }), null);
});

test("every route maps to the area that owns it", () => {
  const cases: Array<[string, AreaId | null]> = [
    ["/dashboard", "home"], ["/dashboard/arena/", "games"], ["/dashboard/", "home"], ["/dashboard/library", "library"], ["/dashboard/gallery", "library"], ["/work/w1", "library"], ["/work/w1/stats", "library"], ["/book/isbn:1", "library"], ["/dashboard/libraryx", null],
    ["/dashboard/murals", "murals"], ["/dashboard/murals/m1", "murals"],
    ["/dashboard/arena", "games"], ["/dashboard/arena/quiz/q1", "games"], ["/dashboard/arena/t1/seed", "games"], ["/arena/t1", "games"],
    ["/dashboard/reader-card", "readerCard"], ["/community/people", "community"], ["/community/u/alice", "community"],
    ["/dashboard/settings/appearance", "settings"], ["/dashboard/style", "settings"], ["/admin/synopses", "admin"], ["/login", null]
  ];
  for (const [path, id] of cases) assert.equal(areaIdForPath(path), id, path);
});

test("back links go to the tab the item belongs to", () => {
  assert.deepEqual(backTo("tierlist"), { to: "/dashboard/arena?tab=tierlists", label: "Games" });
  assert.deepEqual(backTo("quiz"), { to: "/dashboard/arena?tab=quizzes", label: "Games" });
  assert.deepEqual(backTo("tournament"), { to: "/dashboard/arena", label: "Games" });
  assert.deepEqual(backTo("mural"), { to: "/dashboard/murals", label: "Murals" });
  assert.deepEqual(backTo("book"), { to: "/dashboard/library", label: "Library" });
  assert.deepEqual(backTo("profile"), { to: "/community/discover", label: "Community" });
});
