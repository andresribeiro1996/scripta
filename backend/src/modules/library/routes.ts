// HTTP layer for the library module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// Cross-module dependency in action: authGuard is imported from auth's
// PUBLIC interface (modules/auth/index.js), never from anything inside
// modules/auth/domain, /adapters, or /service.ts. This module has no path
// to auth's database or token secrets — only to this one preHandler.
//
// Two separate builder functions, not one — plugin.ts registers each in
// its OWN Fastify encapsulation scope, same split (and same reasoning) as
// modules/murals/routes.ts's buildMuralRoutes/buildPublicLibraryRoutes:
// the authenticated CRUD routes below get no rate limit at all (ordinary
// library editing/saving shouldn't be throttled), while the public
// GET /library/shared/:token route gets its own tight limit — previously
// this module had NO rate limit anywhere, leaving that public,
// unauthenticated, DB-querying route wide open.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import { NoLibraryDocumentError } from "./domain/errors.js";
import type { LibraryService } from "./service.js";

// Deliberately light-touch: this only checks the document is a plausible
// library export (an object with a `books` array), the same minimum the
// viewer itself already expects — it does not otherwise care what's
// inside `books`. The library module treats the document as an opaque
// blob; it doesn't try to understand a book's shape.
const saveLibrarySchema = z.object({
  data: z
    .object({
      books: z.array(z.unknown())
    })
    .passthrough()
});

/** The authenticated surface — get/save/share/unshare, all behind
 *  authGuard. Registered in plugin.ts with no rate limit, same as before. */
export function buildLibraryRoutes(service: LibraryService) {
  return async function libraryRoutes(app: FastifyInstance) {
    app.get("/library", { preHandler: authGuard }, async (request, reply) => {
      const library = service.getLibrary(request.user.id);
      if (!library) {
        return reply.code(404).send({ error: "No library saved yet." });
      }
      return reply.send(library);
    });

    app.put("/library", { preHandler: authGuard }, async (request, reply) => {
      const parsed = saveLibrarySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Expected {"data": {"books": [...], ...}} — see the exporter\'s library.json shape.'
        });
      }
      const library = service.saveLibrary(request.user.id, parsed.data.data);
      return reply.send(library);
    });

    app.post("/library/share", { preHandler: authGuard }, async (request, reply) => {
      try {
        const library = service.share(request.user.id);
        return reply.send(library);
      } catch (err) {
        if (err instanceof NoLibraryDocumentError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    });

    app.post("/library/unshare", { preHandler: authGuard }, async (request, reply) => {
      service.unshare(request.user.id);
      const library = service.getLibrary(request.user.id);
      if (!library) {
        return reply.code(404).send({ error: "No library saved yet." });
      }
      return reply.send(library);
    });
  };
}

/** The public, unauthenticated surface — just GET /library/shared/:token.
 *  Registered in plugin.ts in its OWN scope, carrying its own rate limit —
 *  see this module's own top comment and plugin.ts. */
export function buildPublicLibraryRoutes(service: LibraryService) {
  return async function publicLibraryRoutes(app: FastifyInstance) {
    // Deliberately NOT behind authGuard — same trust model as
    // modules/gallery/routes.ts's GET /gallery/:id/file: the token is an
    // unguessable UUID, not a session check. Unlike that route's
    // immutable re-encoded file, this is a LIVE view of whatever the
    // owner's library currently holds (and can be unshared at any
    // moment), so it must never be cached.
    app.get<{ Params: { token: string } }>("/library/shared/:token", async (request, reply) => {
      const shared = service.getPublicByToken(request.params.token);
      if (!shared) {
        return reply.code(404).send({ error: "No shared library at that link." });
      }
      reply.header("Cache-Control", "no-store");
      return reply.send(shared);
    });
  };
}
