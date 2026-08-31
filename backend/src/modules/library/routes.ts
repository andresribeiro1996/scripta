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
import type { LibraryService } from "./service.js";

// Deliberately light-touch: this only checks the document is a plausible
// library export (an object with a `books` array), the same minimum the
// viewer itself already expects — it does not otherwise care what's
// inside `books`. The library module treats the document as an opaque
// blob; it doesn't try to understand a book's shape.
/** Upper bound on a whole-library PUT. Generous enough for a large
 *  personal library with highlights (the payload this endpoint exists to
 *  carry), bounded enough that it can't be used to push arbitrary
 *  megabytes at the server. */
export const MAX_LIBRARY_DOCUMENT_BYTES = 32 * 1024 * 1024;

const saveLibrarySchema = z.object({
  data: z
    .object({
      books: z.array(z.unknown())
    })
    .passthrough()
});

export function buildLibraryRoutes(service: LibraryService) {
  return async function libraryRoutes(app: FastifyInstance) {
    app.get("/library", { preHandler: authGuard }, async (request, reply) => {
      const library = service.getLibrary(request.user.id);
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
    // send-everything. Slice 2's per-entity writes are what actually make
    // request size proportional to what changed.
    app.put("/library", { preHandler: authGuard, bodyLimit: MAX_LIBRARY_DOCUMENT_BYTES }, async (request, reply) => {
      const parsed = saveLibrarySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Expected {"data": {"books": [...], ...}} — see the exporter\'s library.json shape.'
        });
      }
      const library = service.saveLibrary(request.user.id, parsed.data.data);
      return reply.send(library);
    });
  };
}
