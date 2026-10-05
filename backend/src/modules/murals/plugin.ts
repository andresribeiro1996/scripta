// The murals module's Fastify plugin and composition root — mirrors
// modules/library/plugin.ts's shape, plus modules/books/plugin.ts's
// pattern of registering EACH route builder in its own Fastify
// encapsulation scope so each can carry its own independent rate limit.

import fastifyRateLimit from "@fastify/rate-limit";
import type { ThemeId } from "@scripta/shared/themes";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import type { TierlistData } from "../tierlists/index.js";
import { createSqliteMuralsRepository } from "./adapters/sqlite/sqliteMuralsRepository.js";
import { openMuralsDb } from "./adapters/sqlite/connection.js";
import { buildMuralRoutes, buildPublicMuralRoutes } from "./routes.js";
import { createMuralsPublicApi, type MuralsPublicApi } from "./publicApi.js";
import { createMuralsService } from "./service.js";

/** Wiring handed in by app.ts: `resolveOwnerTheme` seeds a new mural's
 *  theme from the owner's account; the optional `getTierlistData` (when the
 *  tierlists module is present) lets GET /murals/shared/:token resolve
 *  tierlist block references. See routes.ts's buildPublicMuralRoutes. */
export interface MuralsPluginOptions {
  resolveOwnerTheme: (userId: string) => ThemeId;
  getTierlistData?: (ownerUserId: string, tierlistId: string) => TierlistData | undefined;
}

export async function muralsPlugin(app: FastifyInstance, opts: MuralsPluginOptions) {
  // --- composition: swap this one block to change storage technology ---
  const db = openMuralsDb();
  const muralsRepository = createSqliteMuralsRepository(db);
  // Same publicUrlFor pattern as modules/library/plugin.ts, pointed at
  // the FRONTEND's own share-viewer page (not this API) — the token
  // lands in a link a person opens in their browser, not an <img src>.
  const publicUrlFor = (token: string) => `${env.FRONTEND_URL}/shared/murals/${token}`;
  const muralsService = createMuralsService(muralsRepository, publicUrlFor, opts.resolveOwnerTheme);
  // -----------------------------------------------------------------------

  // Two SEPARATE registrations, each its own Fastify encapsulation scope,
  // same trick modules/books/plugin.ts uses (see that file's own
  // comment for the full reasoning): a single rate limit shared across
  // the WHOLE plugin used to also cover ordinary authenticated editing
  // (one PUT per drag-end/resize-end/block-add/rename), which trivially
  // blew through 30/min and 429'd even plain GET /murals — the entire
  // Murals section going dark with no error shown. The public share
  // route is the one that actually needs a tight limit; the authenticated
  // CRUD surface below gets none at all, matching modules/library's own
  // (unlimited) CRUD routes — an authenticated user hammering their own
  // mural isn't the threat model this ever protected against.
  await app.register(buildMuralRoutes(muralsService));

  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(buildPublicMuralRoutes(muralsService, opts.getTierlistData));
  });
}

let cachedPublicApi: MuralsPublicApi | null = null;

export function getMuralsPublicApi(getTierlistData?: (ownerUserId: string, tierlistId: string) => TierlistData | undefined): MuralsPublicApi {
  if (!cachedPublicApi) {
    cachedPublicApi = createMuralsPublicApi(createSqliteMuralsRepository(openMuralsDb()), getTierlistData);
  }
  return cachedPublicApi;
}

let rekeyingMurals: ReturnType<typeof createSqliteMuralsRepository> | undefined;

export function rekeyMuralsBooks(userId: string, fromKeys: string[], toKey: string, toWork: string | null) {
  (rekeyingMurals ??= createSqliteMuralsRepository(openMuralsDb())).rekeyBooks(userId, fromKeys, toKey, toWork);
}

let erasingMurals: ReturnType<typeof createSqliteMuralsRepository> | undefined;

export function deleteMuralsUserData(userId: string) {
  (erasingMurals ??= createSqliteMuralsRepository(openMuralsDb())).deleteUserData(userId);
}
