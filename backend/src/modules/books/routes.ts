import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import { MAX_UPLOAD_BYTES, type BooksService, type CoverFileSize } from "./booksService.js";
import { BookNotFoundError, FileTooLargeError, InvalidImageError, SourceUnavailableError } from "./domain/errors.js";

const lookupSchema = z.object({
  isbn: z.string().max(64).optional(),
  title: z.string().max(500).optional(),
  author: z.string().max(500).optional()
});
const searchSchema = z.object({ q: z.string().max(200) });
const fileParamsSchema = z.object({ id: z.string().uuid(), size: z.enum(["file", "thumb"]) });

const FORBIDDEN = { error: "Only the admin can change shared covers." };
const NOT_FOUND = { error: "No such book." };

const MAX_BATCH = 100;
const batchSchema = z.array(lookupSchema).max(MAX_BATCH);

function isLookable(lookup: z.infer<typeof lookupSchema>) {
  return Boolean(lookup.isbn || lookup.title);
}

export function buildResolveRoutes(service: BooksService) {
  return async function resolveRoutes(app: FastifyInstance) {
    app.get("/covers/resolve", { preHandler: authGuard }, async (request, reply) => {
      const parsed = lookupSchema.safeParse(request.query);
      if (!parsed.success || !isLookable(parsed.data)) {
        return reply.code(400).send({ error: "Send an isbn or a title (author optional)." });
      }
      return reply.send(service.resolveCover(parsed.data, true));
    });

    app.post("/covers/resolve/batch", { preHandler: authGuard }, async (request, reply) => {
      const parsed = batchSchema.safeParse(request.body);
      if (!parsed.success || !parsed.data.every(isLookable)) {
        return reply.code(400).send({ error: `Send up to ${MAX_BATCH} lookups, each with an isbn or a title (author optional).` });
      }
      return reply.send({ results: parsed.data.map((lookup) => service.resolveCover(lookup)) });
    });
  };
}

export function buildCoverFileRoutes(service: BooksService) {
  return async function coverFileRoutes(app: FastifyInstance) {
    app.get("/covers/cached/:id/:size", async (request, reply) => {
      const parsed = fileParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid cover id." });
      const file = service.getCoverFile(parsed.data.id, parsed.data.size as CoverFileSize);
      if (!file) return reply.code(404).send({ error: "No such cached cover." });
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.type(file.mimeType).send(file.buffer);
    });
  };
}

export function buildCatalogRoutes(service: BooksService) {
  return async function catalogRoutes(app: FastifyInstance) {
    app.get("/books/details", { preHandler: authGuard }, async (request, reply) => {
      const parsed = lookupSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid query." });
      try {
        return reply.send({ metadata: await service.getDetails(parsed.data) });
      } catch (error) {
        if (error instanceof SourceUnavailableError) return reply.code(502).send({ error: "Book information is unavailable." });
        throw error;
      }
    });

    app.get("/books/search", { preHandler: authGuard }, async (request, reply) => {
      const parsed = searchSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Send a search query as q." });
      try {
        return reply.send({ results: await service.search(parsed.data.q) });
      } catch (error) {
        if (error instanceof SourceUnavailableError) return reply.code(502).send({ error: "Search is unavailable right now — try again." });
        throw error;
      }
    });
  };
}

export function buildAdminRoutes(service: BooksService) {
  return async function adminRoutes(app: FastifyInstance) {
    app.get("/books/admin", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ isAdmin: service.isAdmin(request.user.id) });
    });

    app.post("/books/cover/reject", { preHandler: authGuard }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(FORBIDDEN);
      const parsed = lookupSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid book." });
      try {
        return reply.send(service.rejectCover(parsed.data));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send(NOT_FOUND);
        throw error;
      }
    });

    app.put("/books/cover", { preHandler: authGuard, bodyLimit: MAX_UPLOAD_BYTES + 1024 }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(FORBIDDEN);
      const parsed = lookupSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid book." });
      const upload = await request.file();
      if (!upload) return reply.code(400).send({ error: "Send the image as a multipart \"image\" field." });
      const buffer = await upload.toBuffer();
      try {
        return reply.send(await service.uploadCover(parsed.data, buffer));
      } catch (error) {
        if (error instanceof FileTooLargeError) return reply.code(413).send({ error: error.message });
        if (error instanceof InvalidImageError) return reply.code(422).send({ error: error.message });
        if (error instanceof BookNotFoundError) return reply.code(404).send(NOT_FOUND);
        throw error;
      }
    });
  };
}
