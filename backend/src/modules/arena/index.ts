// Public interface of the arena module. Everything else in
// modules/arena/ is private implementation — same convention as
// modules/books/index.ts and modules/library/index.ts.

export { arenaPlugin as registerArenaModule, deleteArenaUserData } from "./plugin.js";
export { getArenaPublicApi } from "./plugin.js";
import { createCompletedTournaments, createTournamentGameSource } from "./adapters/communityGameSource.js";
import { getArenaPublicApi } from "./plugin.js";
import type { GameSource } from "../community/index.js";

let cachedGameSource: GameSource<"tournament"> | null = null;
let cachedCompleted: ReturnType<typeof createCompletedTournaments> | null = null;

export function getTournamentGameSource(): GameSource<"tournament"> {
  return (cachedGameSource ??= createTournamentGameSource(getArenaPublicApi()));
}

export function getCompletedTournaments(): ReturnType<typeof createCompletedTournaments> {
  return (cachedCompleted ??= createCompletedTournaments(getArenaPublicApi()));
}
