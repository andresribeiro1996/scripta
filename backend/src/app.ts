// Composes the Fastify app from independent modules. This file is the
// ONLY place that imports a module's public index.ts purely to REGISTER
// it into the app. Modules may also import each other's public index.ts
// directly when they genuinely depend on one another — e.g.
// modules/library/routes.ts imports `authGuard` from modules/auth/index.js,
// since a library document belongs to a signed-in user. What's off-limits
// either way is reaching past a module's index.ts into its internals
// (domain/, adapters/, service.ts) — that's the actual boundary, not "no
// imports between modules at all."

import fastifyCors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { STATUS_CODES } from "node:http";
import { isAllowedOrigin } from "./config/corsOrigin.js";
import { devHttps } from "./config/devCerts.js";
import { runStartupMigrations } from "./migrations/runStartupMigrations.js";
import {
  findUserIdByUsername,
  getDashboardSeenAt,
  registerAuthModule,
  resolvePublicReaderProfile,
  resolvePublicReaderProfiles,
  searchUsernameOwners,
  setDashboardSeenAt,
  userHasUsername
} from "./modules/auth/index.js";
import { getArenaPublicApi, registerArenaModule } from "./modules/arena/index.js";
import { getCommunityPublicApi, registerCommunityModule } from "./modules/community/index.js";
import { registerCoversModule } from "./modules/covers/index.js";
import { registerGalleryModule } from "./modules/gallery/index.js";
import { registerLibraryModule, type BookEvent } from "./modules/library/index.js";
import { getMuralsPublicApi, registerMuralsModule } from "./modules/murals/index.js";
import { registerSocialsModule } from "./modules/socials/index.js";
import { registerTierlistsModule, getTierlistsPublicApi } from "./modules/tierlists/index.js";

export function buildApp() {
  // Moves any still-embedded library.murals[] into the new murals table
  // before any module's routes come online — see
  // migrations/runStartupMigrations.ts for why this is safe to run on
  // every boot. Deliberately before Fastify/app.register: this only
  // touches the two modules' own SQLite files directly, nothing about
  // the app instance itself.
  runStartupMigrations();

  // https only when devCerts.ts found a cert/key pair (see its own
  // comment). Two separate calls, not `https: devHttps`, because
  // Fastify's own overloads pick the http-vs-https server type off the
  // literal shape of this options object — an `https: X | undefined`
  // property defeats that and TS falls back to the http-only overload.
  // The `as FastifyInstance` on the https branch just tells TS to treat
  // both branches as the same instance type it already infers for the
  // plain-http one — this app never touches request.raw/reply.raw (the
  // only APIs that would actually differ between an http.Server and an
  // https.Server), so nothing downstream needs the more specific type.
  const app: FastifyInstance = devHttps ? (Fastify({ logger: true, https: devHttps }) as FastifyInstance) : Fastify({ logger: true });

  // Genuinely app-wide (unlike each module's own rate limiter) — the
  // frontend is a separate origin from this API in dev (Vite on 5173,
  // this on 3000) and will be in production too, so every module's
  // routes need it, not just one. Which origins pass is config/
  // corsOrigin.ts's call: FRONTEND_URL always, plus LAN addresses while
  // ALLOW_LAN_ORIGINS is set (phone testing).
  app.register(fastifyCors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    // Must list every verb the API actually exposes. A method missing
    // here fails in the BROWSER only: the preflight response omits it
    // from Access-Control-Allow-Methods, the browser blocks the real
    // request, and fetch rejects before anything reaches the server — so
    // there's no log line, no status code, and nothing to find
    // server-side. PATCH was added for renaming a tournament
    // (modules/arena) and was missing here, which looked exactly like a
    // save that silently failed. curl can't catch this: it does no
    // preflight. Verify with an OPTIONS carrying Origin and
    // Access-Control-Request-Method instead.
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"]
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Fastify's default 500 serializer forwards the raw error message to
  // the client — SQLite constraint text, file paths, JSON.parse details —
  // on any unhandled throw (a corrupt row on a public share route, a
  // signup TOCTOU race hitting a UNIQUE constraint). Expected 4xx errors
  // keep the default {statusCode, error, message} shape clients already
  // parse; everything else becomes an opaque 500 with the detail logged
  // server-side only.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (statusCode === 500) {
      request.log.error(error);
      return reply.code(500).send({ error: "Internal server error" });
    }
    return reply.code(statusCode).send({ statusCode, error: STATUS_CODES[statusCode] ?? "Error", message: error.message });
  });

  app.register(registerAuthModule, { authRoot: app });
  app.register(registerArenaModule, {
    emitPublished: (tournamentId: string, ownerUserId: string) => getCommunityPublicApi().emitEvent(ownerUserId, "tournament_published", "tournament", tournamentId),
    emitVotedOn: (voterUserId: string, tournamentId: string, name: string | null) => {
      try {
        getCommunityPublicApi().emitEvent(voterUserId, "voted_on", "tournament", tournamentId, { game: "tournament", id: tournamentId, name: name ?? "" });
      } catch (error) {
        app.log.error(error, "failed to record voted_on for tournament");
      }
    }
  });
  app.register(registerLibraryModule, {
    emitBookEvents: (userId: string, events: BookEvent[]) => {
      for (const event of events) {
        try {
          getCommunityPublicApi().emitEvent(userId, event.type, "book", event.refId, event.payload);
        } catch (error) {
          app.log.error(error, "failed to record book activity event");
        }
      }
    }
  });
  app.register(registerGalleryModule);
  app.register(registerCoversModule);
  app.register(registerSocialsModule);
  app.register(registerMuralsModule, {
    // Cross-module wiring, same shape as covers' peekCachedCoverUrl
    // consumers: the murals module never imports tierlists' internals —
    // app.ts hands it this one function, and only for the public shared
    // mural route's tierlist block resolution (see murals/plugin.ts).
    getTierlistData: getTierlistsPublicApi().getTierlistData
  });
  app.register(registerCommunityModule, {
    resolveProfile: resolvePublicReaderProfile,
    resolveProfiles: resolvePublicReaderProfiles,
    userHasUsername,
    findUserIdByUsername,
    searchUsernameOwners,
    getDashboardSeenAt,
    setDashboardSeenAt,
    murals: getMuralsPublicApi(getTierlistsPublicApi().getTierlistData),
    tierlists: {
      list: getTierlistsPublicApi().listPublished,
      get: getTierlistsPublicApi().getPublished,
      listByOwner: getTierlistsPublicApi().listPublishedByOwner,
      listVotedByUser: getTierlistsPublicApi().listVotedByUser
    },
    tournaments: {
      list: getArenaPublicApi().listPublished,
      get: getArenaPublicApi().getPublished,
      listByOwner: getArenaPublicApi().listPublishedByOwner
    }
  });
  app.register(registerTierlistsModule, {
    emitPublished: (copyId: string, ownerUserId: string) => getCommunityPublicApi().emitEvent(ownerUserId, "tierlist_published", "tierlist", copyId),
    emitVotedOn: (voterUserId: string, tierlistId: string, tierlistName: string) => {
      try {
        getCommunityPublicApi().emitEvent(voterUserId, "voted_on", "tierlist", tierlistId, { game: "tierlist", id: tierlistId, name: tierlistName });
      } catch (error) {
        app.log.error(error, "failed to record voted_on for tierlist");
      }
    }
  });

  return app;
}
