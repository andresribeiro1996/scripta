// HTTP layer for the library module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// Cross-module dependency in action: authGuard is imported from auth's
// PUBLIC interface (modules/auth/index.js), never from anything inside
// modules/auth/domain, /adapters, or /service.ts. This module has no path
// to auth's database or token secrets — only to this one preHandler.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import { LibraryEntityNotFoundError, LibraryVersionConflictError } from "./domain/errors.js";
import type { LibraryService } from "./service.js";

/** Upper bound on a whole-library PUT. Generous enough for a large
 *  library with highlights (the payload this endpoint exists to carry),
 *  bounded enough that it can't be used to push arbitrary megabytes at
 *  the server. */
export const MAX_LIBRARY_DOCUMENT_BYTES = 32 * 1024 * 1024;

// Deliberately light-touch: this only checks the document is a plausible
// library export (an object with a `books` array), the same minimum the
// viewer itself already expects — it does not otherwise care what's
// inside `books`.
//
// `expectedVersion` is the optimistic-concurrency precondition. Optional,
// because the first save of a library has no version to quote and because
// an explicit "replace whatever is there" still needs to be expressible.
// When present and stale, the write is refused with 409 rather than
// silently overwriting whatever the user's other device just saved.
const saveLibrarySchema = z.object({
  data: z
    .object({
      books: z.array(z.unknown())
    })
    .passthrough(),
  expectedVersion: z.number().int().nonnegative().optional()
});

const blockLayoutSchema = z.object({
  layout: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().positive(),
    h: z.number().int().positive()
  }),
  expectedVersion: z.number().int().nonnegative().optional()
});

const muralBlockParamsSchema = z.object({
  muralId: z.string().min(1),
  blockId: z.string().min(1)
});

export function buildLibraryRoutes(service: LibraryService) {
  return async function libraryRoutes(app: FastifyInstance) {
    app.get("/library", { preHandler: authGuard }, async (request, reply) => {
      const library = await service.getLibrary(request.user.id);
      if (!library) {
        return reply.code(404).send({ error: "No library saved yet." });
      }
      return reply.send(library);
    });

    // Fastify's default body limit is 1 MB, which a real Kobo library with
    // a few hundred books and their highlights clears easily — those users
    // were getting a silent 413 on every save. Raised deliberately here
    // rather than app-wide, so it applies to this one known-large payload
    // and not to every route in the app.
    //
    // This is a ceiling, not a fix: the document endpoint is inherently
    // send-everything. The per-entity routes below are what make request
    // size proportional to what actually changed.
    app.put("/library", { preHandler: authGuard, bodyLimit: MAX_LIBRARY_DOCUMENT_BYTES }, async (request, reply) => {
      const parsed = saveLibrarySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Expected {"data": {"books": [...], ...}} — see the exporter\'s library.json shape.'
        });
      }

      try {
        const library = await service.saveLibrary(request.user.id, parsed.data.data, parsed.data.expectedVersion);
        return reply.send(library);
      } catch (err) {
        if (err instanceof LibraryVersionConflictError) {
          // The current document rides along with the 409 so the client can
          // re-apply its change on top of it without a second round trip —
          // the difference between "your edit was rejected" and "your edit
          // was merged", from the user's point of view.
          return reply.code(409).send({
            error: err.message,
            currentVersion: err.currentVersion,
            current: await service.getLibrary(request.user.id)
          });
        }
        throw err;
      }
    });

    // One block's position, rather than the whole library. This is the
    // hot path: MuralEditorPage fires it on every drag/resize drop, and
    // routing that through PUT /library meant every gesture rewrote every
    // book, group and mural the account had.
    app.put(
      "/library/murals/:muralId/blocks/:blockId/layout",
      { preHandler: authGuard },
      async (request, reply) => {
        const params = muralBlockParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ error: "Invalid mural or block id." });
        }

        const body = blockLayoutSchema.safeParse(request.body);
        if (!body.success) {
          return reply.code(400).send({
            error: 'Expected {"layout": {"x": 0, "y": 0, "w": 1, "h": 1}} with non-negative integers.'
          });
        }

        try {
          const result = await service.saveMuralBlockLayout(
            request.user.id,
            params.data.muralId,
            params.data.blockId,
            body.data.layout,
            body.data.expectedVersion
          );
          return reply.send(result);
        } catch (err) {
          if (err instanceof LibraryVersionConflictError) {
            return reply.code(409).send({ error: err.message, currentVersion: err.currentVersion });
          }
          if (err instanceof LibraryEntityNotFoundError) {
            return reply.code(404).send({ error: err.message });
          }
          throw err;
        }
      }
    );
  };
}
