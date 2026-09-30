// Public interface of the arena module. Everything else in
// modules/arena/ is private implementation — same convention as
// modules/books/index.ts and modules/library/index.ts.

export { arenaPlugin as registerArenaModule, deleteArenaUserData } from "./plugin.js";
export { getArenaPublicApi } from "./plugin.js";
