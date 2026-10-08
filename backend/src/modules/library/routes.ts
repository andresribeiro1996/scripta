import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CARD_PRINTS, CORNER_STYLES, COUNTERS, FOOTER_LEFTS, FOOTER_RIGHTS, LAYOUTS, MOTTO_LOOKS, MOTTO_MAX, SIGNATURE_NOTE_MAX, TRAITS, type LibraryChange } from "@scripta/shared";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authGuard, rateLimitKey, readerNumberOf } from "../auth/index.js";
import { LIBRARY_SMALL_SAVE_MAX_BYTES } from "./domain/constants.js";
import { InvalidReaderCardChoiceError, LibraryChangeNotFoundError, LibraryConflictError, LibraryTooLargeError, NoLibraryDocumentError } from "./domain/errors.js";
import type { LibraryDocumentText } from "./domain/types.js";
import { libraryTooLargeMessage } from "./domain/sizeLimit.js";
import { ImportBusyError, InvalidImportError, parseImport } from "./import/parseImport.js";
import type { LibraryService } from "./service.js";

const CHANGE_BODY_LIMIT_BYTES = 64 * 1024;

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

function libraryTooLargeBody() {
  return {
    error: libraryTooLargeMessage(env.LIBRARY_BODY_LIMIT_BYTES),
    code: "LIBRARY_BODY_TOO_LARGE",
    maxBytes: env.LIBRARY_BODY_LIMIT_BYTES
  };
}

export function libraryWriteLimit(request: Pick<FastifyRequest, "method" | "headers">) {
  const declared = request.headers["content-length"] ?? "";
  const small = /^\d+$/.test(declared) && Number(declared) <= LIBRARY_SMALL_SAVE_MAX_BYTES;
  return request.method === "PUT" && small ? 120 : 30;
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
  updatedAt: z.string().datetime().optional(),
  source: z.enum(["import"]).optional(),
  data: z
    .object({
      books: z.array(z.unknown())
    })
    .passthrough()
});

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const date = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day);
  });

const addBookSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  isbn: z.string().min(1).nullable().optional(),
  coverUrl: z.string().min(1).nullable().optional(),
  readStatus: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  day: daySchema.optional()
});

const mergeBooksSchema = z.object({
  keep: z.string().min(1),
  merge: z.array(z.string().min(1)).max(50),
  updatedAt: z.string().datetime()
});

const bookKeySchema = z.string().min(1).max(2000);

const readerCardStylePatchSchema = z.object({
  counter: z.enum(COUNTERS).optional(),
  layout: z.enum(LAYOUTS).optional(),
  trait: z.enum(TRAITS).optional(),
  motto: z.object({ text: z.string().trim().min(1).max(MOTTO_MAX), look: z.enum(MOTTO_LOOKS) }).strict().nullable().optional(),
  footer: z.object({ left: z.enum(FOOTER_LEFTS), right: z.enum(FOOTER_RIGHTS) }).strict().optional(),
  corners: z.enum(CORNER_STYLES).optional(),
  print: z.enum(CARD_PRINTS).optional(),
  signature: z.object({ bookKey: bookKeySchema, note: z.string().trim().max(SIGNATURE_NOTE_MAX).nullable().default(null) }).strict().nullable().optional(),
  highlight: z.object({ bookKey: bookKeySchema, highlightId: z.string().min(1).max(200) }).strict().nullable().optional(),
}).strict();

const membershipChangeSchema = z.object({ bookKey: bookKeySchema, member: z.boolean() });

const bookChangeSchema = z
  .object({
    bookKey: bookKeySchema,
    readStatus: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
    day: daySchema.optional()
  })
  .refine((body) => body.readStatus !== undefined || body.rating !== undefined)
  .refine((body) => body.readStatus !== 2 || body.day !== undefined);

const addChangeSchema = z.object({ book: z.object({ Title: z.string().min(1) }).passthrough() });

function applyChange(service: LibraryService, userId: string, change: LibraryChange, reply: FastifyReply) {
  try {
    return reply.send(service.applyChange(userId, change));
  } catch (error) {
    if (error instanceof NoLibraryDocumentError || error instanceof LibraryChangeNotFoundError) return reply.code(404).send({ error: error.message });
    if (error instanceof LibraryConflictError) return reply.code(409).send({ error: error.message });
    if (error instanceof LibraryTooLargeError) return reply.code(413).send(libraryTooLargeBody());
    throw error;
  }
}

function sendDocumentText(reply: FastifyReply, document: LibraryDocumentText) {
  const body = `{"data":${document.data},"updatedAt":${JSON.stringify(document.updatedAt)},"shareToken":${JSON.stringify(document.shareToken)},"shareUrl":${JSON.stringify(document.shareUrl)},"works":${JSON.stringify(document.works)}}`;
  return reply.type("application/json; charset=utf-8").send(body);
}

export function buildLibraryRoutes(service: LibraryService) {
  return async function libraryRoutes(app: FastifyInstance) {
    await sweepStaleImportDirs().catch((error) => app.log.warn({ err: error }, "stale import cleanup failed"));

    await app.register(async (reads) => {
      await reads.register(fastifyRateLimit, { max: 60, timeWindow: "1 minute", keyGenerator: rateLimitKey });

      reads.get("/library", { preHandler: authGuard }, async (request, reply) => {
        const library = service.getLibraryText(request.user.id);
        if (!library) {
          return reply.code(404).send({ error: "No library saved yet." });
        }
        return sendDocumentText(reply, library);
      });
    });

    await app.register(async (writes) => {
      await writes.register(fastifyRateLimit, { max: libraryWriteLimit, timeWindow: "1 minute", keyGenerator: rateLimitKey });

      writes.put("/library", {
        onRequest: authGuard,
        bodyLimit: env.LIBRARY_BODY_LIMIT_BYTES,
        errorHandler(error, _request, reply) {
          if (error.statusCode === 413) return reply.code(413).send(libraryTooLargeBody());
          throw error;
        }
      }, async (request, reply) => {
        const parsed = saveLibrarySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({
            error: 'Expected {"data": {"books": [...], ...}} — see the exporter\'s library.json shape.'
          });
        }
        try {
          const library = service.saveLibrary(request.user.id, parsed.data.data, parsed.data.updatedAt, parsed.data.source);
          return sendDocumentText(reply, library);
        } catch (error) {
          if (error instanceof LibraryConflictError) {
            return reply.code(409).send({ error: error.message, current: service.getLibrary(request.user.id) });
          }
          throw error;
        }
      });

      writes.post("/library/books", { preHandler: authGuard }, async (request, reply) => {
        const parsed = addBookSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Expected { title, author, readStatus } — isbn/coverUrl optional." });
        }
        try {
          return reply.send(service.addBook(request.user.id, parsed.data));
        } catch (error) {
          if (error instanceof LibraryConflictError) {
            return reply.code(409).send({ error: error.message });
          }
          if (error instanceof LibraryTooLargeError) return reply.code(413).send(libraryTooLargeBody());
          throw error;
        }
      });

      writes.post("/library/books/add", { preHandler: authGuard, bodyLimit: CHANGE_BODY_LIMIT_BYTES }, async (request, reply) => {
        const parsed = addChangeSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "Expected { book } with a non-empty Title." });
        return applyChange(service, request.user.id, { kind: "add", book: parsed.data.book }, reply);
      });

      writes.post("/library/books/merge", { preHandler: authGuard }, async (request, reply) => {
        const parsed = mergeBooksSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Expected { keep, merge: [...], updatedAt }." });
        }
        try {
          return sendDocumentText(reply, service.mergeBooks(request.user.id, parsed.data.keep, parsed.data.merge, parsed.data.updatedAt));
        } catch (error) {
          if (error instanceof NoLibraryDocumentError) return reply.code(404).send({ error: "No library saved yet." });
          if (error instanceof LibraryConflictError) {
            return reply.code(409).send({ error: error.message, current: service.getLibrary(request.user.id) });
          }
          if (error instanceof LibraryTooLargeError) return reply.code(413).send(libraryTooLargeBody());
          throw error;
        }
      });

      writes.post("/library/share", { preHandler: authGuard }, async (request, reply) => {
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

      writes.post("/library/unshare", { preHandler: authGuard }, async (request, reply) => {
        service.unshare(request.user.id);
        const library = service.getLibrary(request.user.id);
        if (!library) {
          return reply.code(404).send({ error: "No library saved yet." });
        }
        return reply.send(library);
      });
    });

    await app.register(async (changes) => {
      await changes.register(fastifyRateLimit, { max: 60, timeWindow: "1 minute", keyGenerator: rateLimitKey });

      changes.post<{ Params: { groupId: string } }>("/library/groups/:groupId/books", { preHandler: authGuard, bodyLimit: CHANGE_BODY_LIMIT_BYTES }, async (request, reply) => {
        const parsed = membershipChangeSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "Expected { bookKey, member }." });
        return applyChange(service, request.user.id, { kind: "membership", groupId: request.params.groupId, ...parsed.data }, reply);
      });

      changes.patch("/library/books", { preHandler: authGuard, bodyLimit: CHANGE_BODY_LIMIT_BYTES }, async (request, reply) => {
        const parsed = bookChangeSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "Expected { bookKey, readStatus?, rating?, day? } with readStatus or rating, and day for readStatus 2." });
        const { readStatus, day, bookKey, rating } = parsed.data;
        const change: LibraryChange = readStatus === 2 ? { kind: "book", bookKey, rating, readStatus, day: day! } : { kind: "book", bookKey, rating, readStatus, day };
        return applyChange(service, request.user.id, change, reply);
      });
    });

    await app.register(async (cards) => {
      await cards.register(fastifyRateLimit, { max: 120, timeWindow: "1 minute", keyGenerator: rateLimitKey });

      cards.get("/library/reader-card/style", { preHandler: authGuard }, async (request) => service.getReaderCardStyle(request.user.id));
      cards.get("/library/reader-card/number", { preHandler: authGuard }, async (request) => ({ readerNumber: readerNumberOf(request.user.id) ?? null }));

      cards.patch("/library/reader-card/style", { preHandler: authGuard }, async (request, reply) => {
        const parsed = readerCardStylePatchSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "Expected a reader card style change with known options." });
        try {
          return reply.send(service.patchReaderCardStyle(request.user.id, parsed.data));
        } catch (error) {
          if (error instanceof InvalidReaderCardChoiceError) return reply.code(400).send({ error: error.message });
          throw error;
        }
      });
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
  };
}

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
