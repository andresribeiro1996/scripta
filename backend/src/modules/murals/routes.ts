// HTTP layer for the murals module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// Cross-module dependency in action, same as modules/library/routes.ts
// and modules/gallery/routes.ts: authGuard comes from auth's PUBLIC
// interface only.
//
// "Not found or not owned" is a plain undefined/boolean check here, same
// convention as modules/gallery/routes.ts's DELETE /gallery/:id and
// modules/library/routes.ts's GET /library — not a caught exception (see
// domain/errors.ts for why this module doesn't use one for that case).
//
// Two separate builder functions, not one — plugin.ts registers each in
// its OWN Fastify encapsulation scope specifically so they can carry
// DIFFERENT rate limits, same reasoning and same split as
// modules/covers/routes.ts's buildResolveRoute/buildCachedFileRoute: the
// authenticated CRUD routes below back ordinary mural editing (one PUT
// per drag-end/resize-end/block-add/rename), which can easily fire well
// over 30 requests/minute during a normal editing session; the public
// GET /murals/shared/:token route is the one that actually needs a tight
// limit, same as it always did.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authGuard } from "../auth/index.js";
// Cross-module dependency, same as authGuard above: resolvePublicLibraryData
// is library's own PUBLIC surface for exactly this — see
// modules/library/publicResolver.ts's top comment for the privacy
// boundary it enforces. Never reach into modules/library's internals
// (service.ts, adapters/, domain/) from here.
import { resolvePublicLibraryData } from "../library/index.js";
import type { TierlistData } from "../tierlists/index.js";
import { extractReferences } from "./domain/blockRefs.js";
import { FolderCycleError, InvalidFolderReferenceError } from "./domain/errors.js";
import type { MuralsService } from "./service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const createMuralSchema = z.object({
  name: z.string().min(1, "name is required and must be non-empty."),
  folderId: z.string().uuid().nullable().optional()
});

// Deliberately light-touch, same treatment modules/library/routes.ts
// gives its own opaque `data` blob: this only checks blocks is an array —
// it doesn't otherwise care what a block looks like.
const updateMuralSchema = z
  .object({
    name: z.string().min(1).optional(),
    blocks: z.array(z.unknown()).optional(),
    folderId: z.string().uuid().nullable().optional()
  })
  .refine((body) => body.name !== undefined || body.blocks !== undefined || body.folderId !== undefined, {
    message: "At least one of name, blocks, or folderId must be provided."
  });

const setCoverSchema = z.object({
  imageId: z.string().min(1),
  url: z.string().min(1)
});

const createFolderSchema = z.object({
  name: z.string().min(1, "name is required and must be non-empty."),
  parentId: z.string().uuid().nullable().optional()
});

const updateFolderSchema = z
  .object({
    name: z.string().min(1).optional(),
    parentId: z.string().uuid().nullable().optional()
  })
  .refine((body) => body.name !== undefined || body.parentId !== undefined, {
    message: "At least one of name or parentId must be provided."
  });

/** The authenticated CRUD + share/unshare surface — everything that needs
 *  a signed-in user, and that a normal editing session can call at real
 *  volume. Registered in plugin.ts either with no rate limit at all
 *  (matching modules/library's own CRUD routes) or a generous ceiling —
 *  see plugin.ts's own comment for which. */
export function buildMuralRoutes(service: MuralsService) {
  return async function muralRoutes(app: FastifyInstance) {
    app.get("/murals", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ murals: service.listMurals(request.user.id) });
    });

    app.post("/murals", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createMuralSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      try {
        const mural = service.createMural(request.user.id, parsed.data.name, parsed.data.folderId ?? null);
        return reply.code(201).send(mural);
      } catch (err) {
        if (err instanceof InvalidFolderReferenceError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

    app.get("/murals/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const mural = service.getMural(request.user.id, params.data.id);
      if (!mural) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.send(mural);
    });

    app.put("/murals/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const body = updateMuralSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      try {
        const mural = service.updateMural(request.user.id, params.data.id, body.data);
        if (!mural) {
          return reply.code(404).send({ error: "No mural with that id." });
        }
        return reply.send(mural);
      } catch (err) {
        if (err instanceof InvalidFolderReferenceError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

    app.delete("/murals/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const deleted = service.deleteMural(request.user.id, params.data.id);
      if (!deleted) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.code(204).send();
    });

    app.put("/murals/:id/cover", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const body = setCoverSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Expected {"imageId": string, "url": string}.' });
      }
      const mural = service.setCover(request.user.id, params.data.id, body.data.imageId, body.data.url);
      if (!mural) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.send(mural);
    });

    app.delete("/murals/:id/cover", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const mural = service.clearCover(request.user.id, params.data.id);
      if (!mural) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.send(mural);
    });

    app.post("/murals/:id/share", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const mural = service.share(request.user.id, params.data.id);
      if (!mural) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.send(mural);
    });

    app.post("/murals/:id/unshare", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mural id." });
      }
      const mural = service.unshare(request.user.id, params.data.id);
      if (!mural) {
        return reply.code(404).send({ error: "No mural with that id." });
      }
      return reply.send(mural);
    });

    app.get("/murals/folders", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ folders: service.listFolders(request.user.id) });
    });

    app.post("/murals/folders", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createFolderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      try {
        const folder = service.createFolder(request.user.id, parsed.data.name, parsed.data.parentId ?? null);
        return reply.code(201).send(folder);
      } catch (err) {
        if (err instanceof InvalidFolderReferenceError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

    app.put("/murals/folders/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid folder id." });
      }
      const body = updateFolderSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      let folder;
      try {
        if (body.data.name !== undefined) {
          folder = service.renameFolder(request.user.id, params.data.id, body.data.name);
        }
        if (body.data.parentId !== undefined) {
          folder = service.moveFolder(request.user.id, params.data.id, body.data.parentId);
        }
      } catch (err) {
        if (err instanceof InvalidFolderReferenceError || err instanceof FolderCycleError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
      if (!folder) {
        return reply.code(404).send({ error: "No folder with that id." });
      }
      return reply.send(folder);
    });

    app.delete("/murals/folders/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid folder id." });
      }
      const deleted = service.deleteFolder(request.user.id, params.data.id);
      if (!deleted) {
        return reply.code(404).send({ error: "No folder with that id." });
      }
      return reply.code(204).send();
    });
  };
}

/** The public, unauthenticated surface — just GET /murals/shared/:token.
 *  Registered in plugin.ts in its OWN scope, carrying its own tight rate
 *  limit — see this module's own top comment and plugin.ts.
 *
 *  `getTierlistData` (optional, threaded from app.ts via plugin.ts)
 *  resolves tierlist blocks' references through the tierlists module's
 *  public API — the one cross-module read this route needs beyond
 *  library's publicResolver. Absent (tests, future compositions without
 *  tierlists), referenced blocks simply resolve to nothing and render
 *  their "unavailable" state client-side. */
export function buildPublicMuralRoutes(service: MuralsService, getTierlistData?: (ownerUserId: string, tierlistId: string) => TierlistData | undefined) {
  return async function publicMuralRoutes(app: FastifyInstance) {
    // Deliberately NOT behind authGuard — same trust model as
    // modules/library/routes.ts's own GET /library/shared/:token: the
    // token is an unguessable UUID, not a session check. A LIVE view of
    // whatever the owner's mural currently holds (and can be unshared at
    // any moment), so it must never be cached. Note this route has TWO
    // path segments ("/murals/shared/:token") vs. GET /murals/:id's ONE —
    // Fastify's router never confuses the two, "shared" is just a literal
    // segment there, not a mural id.
    app.get<{ Params: { token: string } }>("/murals/shared/:token", async (request, reply) => {
      const row = service.getRowByShareToken(request.params.token);
      if (!row) {
        return reply.code(404).send({ error: "No shared mural at that link." });
      }

      // A corrupted/malformed row (shouldn't happen via normal writes,
      // but defensive: this is public, unauthenticated input on the read
      // path) — treat exactly like "no such token" rather than 500ing.
      let blocks: unknown;
      try {
        blocks = JSON.parse(row.blocks);
      } catch {
        return reply.code(404).send({ error: "No shared mural at that link." });
      }

      // extractReferences/resolvePublicLibraryData below are the whole
      // privacy boundary this route exists to enforce — see their own
      // top comments (murals/domain/blockRefs.ts,
      // modules/library/publicResolver.ts) for exactly what is and isn't
      // safe to include in the response built from them.
      const refs = extractReferences(blocks);

      // Tier-list blocks: same resolve-server-side idea as the library
      // refs — the block carries only a tierlistId, and the raw
      // {name, tiers, pool} document goes out under `tierlists` keyed by
      // that id. Resolved BEFORE the library call because tiers/pool
      // hold book KEYS the library resolver must also see, or the
      // shared page would have the tier list but none of its books. A
      // dangling id (tier list deleted since the mural last saved) is
      // simply omitted, which the frontend renders as the block's
      // unavailable state — a shared mural going quietly stale beats
      // a 500.
      const tierlistIds: string[] = [];
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          const candidate = block as { type?: unknown; tierlistId?: unknown };
          if (candidate.type !== "tierlist" || typeof candidate.tierlistId !== "string" || !candidate.tierlistId) continue;
          if (!tierlistIds.includes(candidate.tierlistId)) tierlistIds.push(candidate.tierlistId);
        }
      }
      const tierlists = Object.fromEntries(
        tierlistIds
          .map((id) => [id, getTierlistData?.(row.user_id, id)] as const)
          .filter((entry): entry is readonly [string, TierlistData] => entry[1] !== undefined)
      );
      const tierlistBookKeys = new Set<string>();
      for (const tierlist of Object.values(tierlists)) {
        for (const key of tierlist.pool) tierlistBookKeys.add(key);
        for (const tier of tierlist.tiers) for (const key of tier.bookKeys) tierlistBookKeys.add(key);
      }

      const libraryData = resolvePublicLibraryData(row.user_id, {
        bookKeys: [...refs.bookKeys, ...tierlistBookKeys],
        highlightRefs: refs.highlightRefs,
        needsCurrentlyReading: refs.needsCurrentlyReading,
        statsMetrics: [...refs.statsMetrics]
      });

      // Gallery images: no second cross-module resolver — GET
      // /gallery/:id/file (modules/gallery/routes.ts) is already public
      // and unauthenticated, so a referenced image id is just templated
      // directly into that URL, with no existence check here. A deleted
      // image's id simply 404s on load client-side, matching that
      // route's own documented intended behavior.
      const imageIds = [...refs.imageIds, ...(row.cover_image_id ? [row.cover_image_id] : [])];
      const imageUrls = Object.fromEntries(imageIds.map((id) => [id, `${env.PUBLIC_API_URL}/gallery/${id}/file`]));

      reply.header("Cache-Control", "no-store");
      return reply.send({
        mural: {
          id: row.id,
          name: row.name,
          blocks,
          coverImageUrl: row.cover_image_id ? imageUrls[row.cover_image_id] : row.cover_image_url
        },
        books: libraryData.books,
        highlights: libraryData.highlights,
        currentlyReading: libraryData.currentlyReading,
        stats: libraryData.stats,
        imageUrls,
        tierlists
      });
    });
  };
}
