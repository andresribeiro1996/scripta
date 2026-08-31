// HTTP layer — request validation and mapping the service's result to a
// response. No business logic here, no knowledge of Kobo/Open Library/
// Google Books/Hardcover at all — see service.ts/adapters/.
//
// Two separate builder functions, not one — plugin.ts registers each in
// its OWN Fastify encapsulation scope specifically so they can carry
// DIFFERENT rate limits (see that file's own comment for why: a resolve
// on a MISS is genuinely expensive, a cached file read is not, and a
// real library's full page load fires roughly one of each PER BOOK,
// nearly simultaneously — a single shared limit tight enough to matter
// for the expensive one starves the cheap one too).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import type { CoversService } from "./service.js";

const resolveQuerySchema = z.object({
  isbn: z.string().optional(),
  imageId: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional()
});

const idParamSchema = z.object({ id: z.string().uuid() });

export function buildResolveRoute(service: CoversService) {
  return async function resolveRoute(app: FastifyInstance) {
    // Behind authGuard — this spends real quota on the app's own
    // external sources (Hardcover, Google Books) on a cache MISS, so it
    // shouldn't be open to anyone who isn't a signed-in user of this
    // app, same reasoning the old (now-removed) /covers/hardcover route
    // had. A cache HIT is cheap either way, but there's no way to know
    // which one a given request will be before running it.
    app.get("/covers/resolve", { preHandler: authGuard }, async (request, reply) => {
      const parsed = resolveQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query — isbn/imageId/title/author, all optional strings." });
      }
      const { isbn, imageId, title, author } = parsed.data;
      if (!isbn && !imageId && !title) {
        return reply.code(400).send({ error: "At least one of isbn, imageId, or title is required." });
      }
      const result = await service.resolveCover({ isbn, imageId, title, author });
      // Always 200, even when nothing was found — "no cover anywhere"
      // is a legitimate answer, not an error.
      return reply.send(result);
    });
  };
}

export function buildCachedFileRoute(service: CoversService) {
  return async function cachedFileRoute(app: FastifyInstance) {
    // Deliberately NOT behind authGuard — needs to work as a plain
    // <img src>, same trust model gallery's own GET /gallery/:id/file
    // already has (see that route's own comment): the id is an
    // unguessable random UUID, not a session check.
    app.get("/covers/cached/:id/file", async (request, reply) => {
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid cover id." });
      }
      const file = await service.getCachedCoverFile(parsed.data.id);
      if (!file) {
        return reply.code(404).send({ error: "No such cached cover." });
      }
      // Never changes once cached (no "edit" operation, only ever
      // written once per cache_key) — safe to cache aggressively, same
      // as gallery's own re-encoded output.
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.type(file.mimeType).send(file.buffer);
    });
  };
}
