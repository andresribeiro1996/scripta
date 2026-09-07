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

import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authGuard } from "../auth/index.js";
import { NoLibraryDocumentError } from "./domain/errors.js";
import { ImportBusyError, InvalidImportError, parseImport } from "./import/parseImport.js";
import type { LibraryService } from "./service.js";

const IMPORT_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function sweepStaleImportDirs(now = Date.now()) {
  const directory = tmpdir();
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("scripta-import-")) continue;
    const path = join(directory, entry.name);
    if (now - (await stat(path)).mtimeMs > IMPORT_TMP_MAX_AGE_MS) {
      await rm(path, { recursive: true, force: true });
    }
  }
}

export function rejectOversizedImport(
  request: { raw: { destroy(): void } },
  reply: { code(statusCode: number): { send(payload: unknown): unknown } }
) {
  reply.code(413).send({ error: "Import file is too large.", code: "IMPORT_TOO_LARGE", maxBytes: env.IMPORT_MAX_UPLOAD_BYTES });
  request.raw.destroy();
}

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
    await sweepStaleImportDirs().catch((error) => app.log.warn({ err: error }, "stale import cleanup failed"));

    app.get("/library", { preHandler: authGuard }, async (request, reply) => {
      const library = service.getLibrary(request.user.id);
      if (!library) {
        return reply.code(404).send({ error: "No library saved yet." });
      }
      return reply.send(library);
    });

    app.put("/library", {
      preHandler: authGuard,
      bodyLimit: env.LIBRARY_BODY_LIMIT_BYTES,
      errorHandler(error, _request, reply) {
        if (error.statusCode === 413) {
          return reply.code(413).send({
            error: "Library document is too large.",
            code: "LIBRARY_BODY_TOO_LARGE",
            maxBytes: env.LIBRARY_BODY_LIMIT_BYTES
          });
        }
        throw error;
      }
    }, async (request, reply) => {
      const parsed = saveLibrarySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Expected {"data": {"books": [...], ...}} — see the exporter\'s library.json shape.'
        });
      }
      const library = service.saveLibrary(request.user.id, parsed.data.data);
      return reply.send(library);
    });

    await app.register(async (imports) => {
      await imports.register(fastifyRateLimit, { max: 10, timeWindow: "1 minute" });
      await imports.register(fastifyMultipart, {
        limits: { files: 1, fileSize: env.IMPORT_MAX_UPLOAD_BYTES }
      });
      imports.post("/library/import/preview", {
        preHandler: authGuard
      }, async (request, reply) => {
        const scratch = await mkdtemp(join(tmpdir(), "scripta-import-"));
        const outcome = await (async () => {
          try {
            const upload = await request.file();
            if (!upload) return { status: 400, body: { error: "Upload one import file in multipart field \"file\"." } };
            const path = join(scratch, "upload");
            upload.file.once("limit", () => rejectOversizedImport(request, reply));
            await pipeline(upload.file, createWriteStream(path, { flags: "wx" }));
            if (upload.file.truncated) {
              return { status: 413, body: { error: "Import file is too large.", code: "IMPORT_TOO_LARGE", maxBytes: env.IMPORT_MAX_UPLOAD_BYTES } };
            }
            return { status: 200, body: await parseImport(path, env.IMPORT_PARSE_TIMEOUT_MS, env.LIBRARY_BODY_LIMIT_BYTES, request.log) };
          } catch (error) {
            if (reply.sent) return { status: 413, body: null };
            if (error instanceof InvalidImportError) return { status: 422, body: { error: error.message, code: "INVALID_IMPORT" } };
            if (error instanceof ImportBusyError) return { status: 503, body: { error: error.message, code: "IMPORT_BUSY" } };
            if ((error as { statusCode?: number }).statusCode === 413) {
              return { status: 413, body: { error: "Import file is too large.", code: "IMPORT_TOO_LARGE", maxBytes: env.IMPORT_MAX_UPLOAD_BYTES } };
            }
            throw error;
          } finally {
            await rm(scratch, { recursive: true, force: true });
          }
        })();
        if (reply.sent) return;
        return reply.code(outcome.status).send(outcome.body);
      });
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
