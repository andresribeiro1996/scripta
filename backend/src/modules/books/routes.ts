import type { GenreReview, GenreReviewAction, SynopsisDecision, SynopsisReview, TranslationReview, TranslationReviewAction } from "@scripta/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import { MAX_UPLOAD_BYTES, type BooksService, type CoverFileSize } from "./booksService.js";
import { BookNotFoundError, FileTooLargeError, InvalidImageError, SourceUnavailableError, WorkMergeError } from "./domain/errors.js";
import { labelProblem } from "./genrePass.js";

const lookupSchema = z.object({
  isbn: z.string().max(64).optional(),
  title: z.string().max(500).optional(),
  author: z.string().max(500).optional()
});
const searchSchema = z.object({ q: z.string().max(200) });
const catalogSearchSchema = searchSchema.extend({ by: z.literal("work").optional() });
const fileParamsSchema = z.object({ id: z.string().uuid(), size: z.enum(["file", "thumb"]) });

const FORBIDDEN = { error: "Only the admin can change shared covers." };
const NOT_FOUND = { error: "No such book." };
const WORKS_FORBIDDEN = { error: "Only the admin can change works." };
const mergeSchema = z.object({ from: lookupSchema, into: lookupSchema });
const detachSchema = z.object({ edition: lookupSchema });
const GENRES_FORBIDDEN = { error: "Only the admin can review genres." };
const reviewParamsSchema = z.object({ workId: z.string().min(1).max(64) });
const reviewActionSchema = z.union([z.object({ genres: z.array(z.string().max(64)).max(10) }).strict(), z.object({ retry: z.literal(true) }).strict()]);
const SYNOPSES_FORBIDDEN = { error: "Only the admin can review synopses." };
const synopsisParamsSchema = z.object({ hash: z.string().regex(/^[0-9a-f]{40}$/) });
const synopsisDecisionSchema = z.object({ decision: z.enum(["keep", "hide"]) }).strict();
const TRANSLATIONS_FORBIDDEN = { error: "Only the admin can review translations." };
const translationParamsSchema = z.object({ workId: z.string().min(1).max(64) });
const translationActionSchema = z.union([
  z.object({ merge: z.string().min(1).max(64) }).strict(),
  z.object({ reject: z.literal(true) }).strict(),
  z.object({ undo: z.literal(true) }).strict()
]);

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

export function buildCoverFileRoutes(publicUrlFor: (id: string, size: CoverFileSize) => string) {
  return async function coverFileRoutes(app: FastifyInstance) {
    app.get("/covers/cached/:id/:size", async (request, reply) => {
      const parsed = fileParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid cover id." });
      return reply.redirect(publicUrlFor(parsed.data.id, parsed.data.size), 301);
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
      const parsed = catalogSearchSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Send a search query as q." });
      return reply.send({ results: service.search(parsed.data.q, { byWork: parsed.data.by === "work" }) });
    });

    app.get("/books/search/external", { preHandler: authGuard }, async (request, reply) => {
      const parsed = searchSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Send a search query as q." });
      try {
        return reply.send({ results: await service.searchExternal(parsed.data.q) });
      } catch (error) {
        if (error instanceof SourceUnavailableError) return reply.code(502).send({ error: "Search is unavailable right now — try again." });
        throw error;
      }
    });
  };
}

export function buildAdminRoutes(service: BooksService, groupWorks: () => Promise<number | null>) {
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

    app.post("/books/works/merge", { preHandler: authGuard }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(WORKS_FORBIDDEN);
      const parsed = mergeSchema.safeParse(request.body);
      if (!parsed.success || !isLookable(parsed.data.from) || !isLookable(parsed.data.into)) {
        return reply.code(400).send({ error: "Send from and into, each with an isbn or a title (author optional)." });
      }
      try {
        return reply.send(service.mergeWorks(parsed.data.from, parsed.data.into));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send(NOT_FOUND);
        if (error instanceof WorkMergeError) return reply.code(409).send({ error: error.message });
        throw error;
      }
    });

    app.post("/books/works/group", { preHandler: authGuard }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(WORKS_FORBIDDEN);
      const grouped = await groupWorks();
      if (grouped === null) return reply.code(409).send({ error: "Grouping is already running." });
      return reply.send({ grouped });
    });

    app.post("/books/works/detach", { preHandler: authGuard }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(WORKS_FORBIDDEN);
      const parsed = detachSchema.safeParse(request.body);
      if (!parsed.success || !isLookable(parsed.data.edition)) {
        return reply.code(400).send({ error: "Send the edition with an isbn or a title (author optional)." });
      }
      try {
        return reply.send(service.detachEdition(parsed.data.edition));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send(NOT_FOUND);
        if (error instanceof WorkMergeError) return reply.code(409).send({ error: error.message });
        throw error;
      }
    });
  };
}

export function buildGenreReviewRoutes(deps: {
  isAdmin: (userId: string) => boolean;
  review: () => GenreReview;
  decide: (workId: string, action: GenreReviewAction) => { workId: string; editions: number };
}) {
  return async function genreReviewRoutes(app: FastifyInstance) {
    app.get("/books/genre-review", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(GENRES_FORBIDDEN);
      return reply.send(deps.review());
    });

    app.post("/books/genre-review/:workId", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(GENRES_FORBIDDEN);
      const params = reviewParamsSchema.safeParse(request.params);
      const body = reviewActionSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "Send { genres: [...] } with up to three genres, or { retry: true }." });
      const problem = "genres" in body.data ? labelProblem(body.data.genres) : null;
      if (problem) return reply.code(400).send({ error: `This label ${problem}.` });
      try {
        return reply.send(deps.decide(params.data.workId, body.data));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send({ error: "No such work." });
        throw error;
      }
    });
  };
}

export function buildSynopsisReviewRoutes(deps: {
  isAdmin: (userId: string) => boolean;
  review: () => SynopsisReview;
  decide: (hash: string, decision: SynopsisDecision) => { hash: string };
}) {
  return async function synopsisReviewRoutes(app: FastifyInstance) {
    app.get("/books/synopsis-review", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(SYNOPSES_FORBIDDEN);
      return reply.send(deps.review());
    });

    app.post("/books/synopsis-review/:hash", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(SYNOPSES_FORBIDDEN);
      const params = synopsisParamsSchema.safeParse(request.params);
      const body = synopsisDecisionSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "Send { decision: \"keep\" } or { decision: \"hide\" } for a synopsis hash." });
      try {
        return reply.send(deps.decide(params.data.hash, body.data.decision));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send({ error: "No such synopsis." });
        throw error;
      }
    });
  };
}

export function buildTranslationReviewRoutes(deps: {
  isAdmin: (userId: string) => boolean;
  review: () => TranslationReview;
  decide: (workId: string, action: TranslationReviewAction) => { workId: string };
}) {
  return async function translationReviewRoutes(app: FastifyInstance) {
    app.get("/books/translation-review", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(TRANSLATIONS_FORBIDDEN);
      return reply.send(deps.review());
    });

    app.post("/books/translation-review/:workId", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(TRANSLATIONS_FORBIDDEN);
      const params = translationParamsSchema.safeParse(request.params);
      const body = translationActionSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "Send { merge: workId }, { reject: true } or { undo: true }." });
      try {
        return reply.send(deps.decide(params.data.workId, body.data));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send({ error: "No such work." });
        if (error instanceof WorkMergeError) return reply.code(409).send({ error: error.message });
        throw error;
      }
    });
  };
}
