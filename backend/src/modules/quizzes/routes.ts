// HTTP layer for the quizzes module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// "Not found or not owned" is a plain undefined check here, same
// convention as tierlists' routes — not a caught exception.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { duplicateWorkMessage, firstDuplicateWork, keepFirstPerWork, resolveEntryWorks, resolvePublicLibraryData, WorkResolutionError, workIdsByKey, type WorkRef } from "../library/index.js";
import type { PlayOutcome, Player, QuizzesService } from "./service.js";

const idParamSchema = z.object({ id: z.string().uuid() });
const codeParamSchema = z.object({ code: z.string().min(1).max(64) });

const quizBookSchema = z.object({
  key: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(300),
  // Not .url(): the resolver's cached-cover URLs may be origin-relative.
  coverUrl: z.string().min(1).max(2000).nullable().optional(),
  quote: z.string().trim().max(2000).nullable().optional(),
  blurb: z.string().trim().max(4000).nullable().optional()
});

const quizDataSchema = z.object({
  sourceLabel: z.string().trim().max(200).default(""),
  questionCount: z.number().int().min(1).max(20).default(10),
  allowedTypes: z.array(z.enum(["cover_title", "title_cover", "quote_title", "blurb_title"])).min(1).default(["cover_title", "title_cover", "quote_title", "blurb_title"]),
  books: z.array(quizBookSchema).max(500).default([])
});

const createQuizSchema = z.object({
  name: z.string().trim().min(1, "name is required and must be non-empty.").max(200),
  data: quizDataSchema
});

// Same document validation as POST, not a pass-through record: the quiz
// document drives publish-time question generation, so an unvalidated
// update can poison a later publish (null books made publish 500).
const updateQuizSchema = z
  .object({ name: z.string().min(1).optional(), data: quizDataSchema.optional() })
  .refine((body) => body.name !== undefined || body.data !== undefined, { message: "At least one of name or data must be provided." });

const playStateSchema = z.object({ open: z.boolean() });

const playSchema = z.object({
  answers: z.array(z.object({ questionId: z.string().min(1), choiceIndex: z.number().int().min(0).max(3) })).min(1).max(20),
  durationMs: z.number().int().min(0).max(3_600_000),
  playerName: z.string().trim().max(40).optional()
});

type ResolveQuizWorks = typeof resolveEntryWorks;

function resolveBooks(resolveWorks: ResolveQuizWorks, userId: string, books: z.infer<typeof quizBookSchema>[]): { works: Map<string, WorkRef> } | { status: 503; error: string } {
  try {
    return { works: resolveWorks(userId, books) };
  } catch (err) {
    if (err instanceof WorkResolutionError) return { status: 503, error: err.message };
    throw err;
  }
}

export function buildQuizRoutes(service: QuizzesService, resolveWorks: ResolveQuizWorks = resolveEntryWorks) {
  return async function quizRoutes(app: FastifyInstance) {
    app.get("/quizzes", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ quizzes: service.listQuizzes(request.user.id) });
    });

    app.post("/quizzes", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createQuizSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      const { name, data } = parsed.data;
      const keys = data.books.map((b) => b.key);
      if (new Set(keys).size !== keys.length) return reply.code(400).send({ error: "Duplicate book." });
      const resolved = resolveBooks(resolveWorks, request.user.id, data.books);
      if ("error" in resolved) return reply.code(resolved.status).send({ error: resolved.error });
      const books = keepFirstPerWork(data.books, (book) => book.key, resolved.works);
      const quiz = service.createQuiz(request.user.id, name, { ...data, books }, workIdsByKey(books.map((book) => book.key), resolved.works));
      return reply.code(201).send(quiz);
    });

    app.get("/quizzes/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const quiz = service.getQuiz(request.user.id, params.data.id);
      if (!quiz) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.send(quiz);
    });

    app.put("/quizzes/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const body = updateQuizSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      if (body.data.data) {
        const keys = body.data.data.books.map((b) => b.key);
        if (new Set(keys).size !== keys.length) return reply.code(400).send({ error: "Duplicate book." });
      }
      let works: Map<string, string | null> | undefined;
      if (body.data.data && service.getQuiz(request.user.id, params.data.id)?.voteCode === null) {
        const keys = body.data.data.books.map((b) => b.key);
        const resolved = resolveBooks(resolveWorks, request.user.id, body.data.data.books);
        if ("error" in resolved) return reply.code(resolved.status).send({ error: resolved.error });
        const duplicate = firstDuplicateWork(keys, resolved.works);
        if (duplicate) return reply.code(409).send({ error: duplicateWorkMessage(duplicate) });
        works = workIdsByKey(keys, resolved.works);
      }
      // undefined = not found, not owned, OR already published — a
      // published quiz's seeded set must not drift, and 404 covers all
      // three without leaking which (same convention as tierlists).
      const quiz = service.updateQuiz(request.user.id, params.data.id, body.data, works);
      if (!quiz) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.send(quiz);
    });

    app.delete("/quizzes/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const deleted = service.deleteQuiz(request.user.id, params.data.id);
      if (!deleted) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.code(204).send();
    });

    app.post("/quizzes/:id/publish", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const owned = service.getQuiz(request.user.id, params.data.id);
      if (!owned) return reply.code(404).send({ error: "No quiz with that id." });
      // Same public-cover resolver tierlists' open-voting route uses: book
      // keys become redacted public book shapes, never a raw library read.
      // Only books without their own cover need it — pool picks carry one —
      // and since PublicBookData is keyless (stale keys are skipped), the
      // positional zip is only safe when every requested key resolved.
      const ownedBooks = (owned.data as { books?: Array<{ key: string; coverUrl?: string | null }> }).books ?? [];
      const needCover = ownedBooks.filter((b) => !b.coverUrl);
      const resolved = needCover.length
        ? resolvePublicLibraryData(request.user.id, {
            bookKeys: needCover.map((b) => b.key),
            highlightRefs: [],
            needsCurrentlyReading: false,
            statsMetrics: []
          }).books
        : [];
      const resolvedBooks =
        resolved.length === needCover.length
          ? needCover.map((b, i) => ({ bookKey: b.key, coverUrl: resolved[i]!.coverUrl }))
          : [];
      const outcome = service.publishQuiz(request.user.id, params.data.id, resolvedBooks);
      if (!outcome.ok) {
        if (outcome.reason === "not-found") return reply.code(404).send({ error: "No quiz with that id." });
        if (outcome.reason === "already-published") return reply.code(409).send({ error: outcome.error });
        return reply.code(400).send({ error: outcome.error });
      }
      return reply.code(201).send({ quiz: outcome.quiz, voteCode: outcome.quiz.voteCode });
    });

    app.put("/quizzes/:id/voting", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      const body = playStateSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      const quiz = service.setPlayState(request.user.id, params.data.id, body.data.open);
      if (!quiz) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.send({ quiz });
    });

    app.get("/quizzes/:id/results", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid quiz id." });
      // getResults is ownership-checked inside the service; undefined here
      // can only mean "not found or not owned".
      const results = service.getResults(request.user.id, params.data.id);
      if (!results) return reply.code(404).send({ error: "No quiz with that id." });
      return reply.send(results);
    });
  };
}

/** The public, unauthenticated surface — registered in its OWN Fastify
 *  encapsulation scope by plugin.ts so it carries the tight rate limit,
 *  exactly the split tierlists makes. The code is an identifier, not a
 *  secret: play_open and the answer-key strip are what protect the game. */
export function buildPublicQuizRoutes(service: QuizzesService) {
  return async function publicQuizRoutes(app: FastifyInstance) {
    app.get("/quizzes/voting/:code", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: "No quiz at that link." });
      const board = service.getPlayBoard(params.data.code);
      if (!board) return reply.code(404).send({ error: "No quiz at that link." });
      if (!board.playOpen) return reply.code(403).send({ error: "This quiz isn't open for play." });
      return reply.send({ board });
    });

    app.post("/quizzes/voting/:code/play", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      const body = playSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: "Invalid play." });
      }
      const outcome = service.submitPlay(params.data.code, body.data.answers, body.data.durationMs, body.data.playerName ?? null, playerFor(request, null));
      return sendPlayOutcome(reply, outcome);
    });

    // Two shapes because the caller may hold either half of what playerFor
    // needs: an anonymous player has only the play id their device stored,
    // while a signed-in one is resolved from their account and never has
    // an id to send (same split as tierlists' readBallot).
    const readPlay = async (request: FastifyRequest, reply: FastifyReply) => {
      const params = codeParamSchema.safeParse(request.params);
      const playId = (request.params as { playId?: string }).playId ?? null;
      if (!params.success) return reply.code(404).send({ error: "No quiz at that link." });
      const outcome = service.getPlay(params.data.code, playerFor(request, playId));
      return sendPlayOutcome(reply, outcome);
    };
    app.get("/quizzes/voting/:code/play", readPlay);
    app.get("/quizzes/voting/:code/play/:playId", readPlay);

    app.get("/quizzes/voting/:code/results", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: "No quiz at that link." });
      const results = service.getPublicResults(params.data.code);
      if (!results) return reply.code(404).send({ error: "No quiz at that link." });
      return reply.send(results);
    });
  };
}

/** A signed-in caller always plays as their account (the DB's partial
 *  unique index is the authority on one-play-per-account); everyone else
 *  plays as the play id their browser is holding. */
function playerFor(request: FastifyRequest, playId: string | null): Player {
  const user = getOptionalAuthenticatedUser(request);
  return user ? { kind: "user", userId: user.id } : { kind: "anonymous", playId };
}

function sendPlayOutcome(reply: FastifyReply, outcome: PlayOutcome) {
  if (!outcome.ok) {
    if (outcome.reason === "not-found") return reply.code(404).send({ error: "No quiz at that link." });
    if (outcome.reason === "closed") return reply.code(403).send({ error: "This quiz isn't open for play." });
    if (outcome.reason === "already-played") return reply.code(409).send({ error: "You've already played this quiz." });
    return reply.code(400).send({ error: "Those answers don't match this quiz." });
  }
  return reply.send({ playId: outcome.playId, score: outcome.score, correct: outcome.correct });
}
