// HTTP layer for the quizzes module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// "Not found or not owned" is a plain undefined check here, same
// convention as tierlists' routes — not a caught exception.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { MAX_PLAY_DURATION_MS, QUIZ_QUESTION_TYPES, type PlayResponse } from "@scripta/shared";
import { localeOf, t, validationMessage } from "../../i18n/index.js";
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { duplicateWorkMessage } from "../library/index.js";
import { sendWorksError } from "../../worksErrors.js";
import type { PlayOutcome, Player, QuizWriteOutcome, QuizzesService } from "./service.js";
import { canonicalForQuiz, quizToWorks } from "./wire.js";

const idParamSchema = z.object({ id: z.string().uuid() });
const codeParamSchema = z.object({ code: z.string().min(1).max(64) });

const quizBookSchema = z.object({
  workId: z.string().min(1).max(200).optional(),
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
  allowedTypes: z.array(z.enum(QUIZ_QUESTION_TYPES)).min(1).default(["cover_title", "title_cover", "quote_title", "blurb_title"]),
  books: z.array(quizBookSchema).max(500).default([])
});

const createQuizSchema = z.object({
  name: z.string().trim().min(1, "quizzes.nameRequired").max(200),
  data: quizDataSchema
});

// Same document validation as POST, not a pass-through record: the quiz
// document drives publish-time question generation, so an unvalidated
// update can poison a later publish (null books made publish 500).
const updateQuizSchema = z
  .object({ name: z.string().min(1).optional(), data: quizDataSchema.optional() })
  .refine((body) => body.name !== undefined || body.data !== undefined, { message: "quizzes.updateNeedsField" });

const playStateSchema = z.object({ open: z.boolean() });

const playSchema = z.object({
  answers: z.array(z.object({ questionId: z.string().min(1), choiceIndex: z.number().int().min(0).max(3) })).min(1).max(20),
  durationMs: z.number().int().min(0).max(MAX_PLAY_DURATION_MS),
  playerName: z.string().trim().max(40).optional()
});

function sendWriteFailure(request: FastifyRequest, reply: FastifyReply, outcome: Exclude<QuizWriteOutcome, { ok: true }>) {
  const locale = localeOf(request);
  if (outcome.reason === "duplicate-work") return reply.code(409).send({ error: duplicateWorkMessage(locale, { workId: null, title: outcome.title }) });
  return reply.code(outcome.reason === "not-found" ? 404 : 400).send({ error: t(locale, outcome.error) });
}

export function buildQuizRoutes(service: QuizzesService) {
  return async function quizRoutes(app: FastifyInstance) {
    app.get("/quizzes", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ quizzes: service.listQuizzes(request.user.id).map((quiz) => quizToWorks(quiz)) });
    });

    app.post("/quizzes", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createQuizSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: validationMessage(localeOf(request), parsed.error) });
      try {
        const outcome = service.createQuiz(request.user.id, parsed.data.name, parsed.data.data);
        if (!outcome.ok) return sendWriteFailure(request, reply, outcome);
        return reply.code(201).send(quizToWorks(outcome.quiz, outcome.canonical));
      } catch (err) {
        return sendWorksError(request, reply, err);
      }
    });

    app.get("/quizzes/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: t(localeOf(request), "quizzes.invalidId") });
      const quiz = service.getQuiz(request.user.id, params.data.id);
      if (!quiz) return reply.code(404).send({ error: t(localeOf(request), "quizzes.notFound") });
      return reply.send(quizToWorks(quiz));
    });

    app.put("/quizzes/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: t(localeOf(request), "quizzes.invalidId") });
      const body = updateQuizSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: validationMessage(localeOf(request), body.error) });
      try {
        const outcome = service.updateQuiz(request.user.id, params.data.id, { ...(body.data.name !== undefined ? { name: body.data.name } : {}), ...(body.data.data !== undefined ? { data: body.data.data } : {}) });
        if (!outcome.ok) return sendWriteFailure(request, reply, outcome);
        return reply.send(quizToWorks(outcome.quiz, outcome.canonical));
      } catch (err) {
        return sendWorksError(request, reply, err);
      }
    });

    app.delete("/quizzes/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: t(localeOf(request), "quizzes.invalidId") });
      const deleted = service.deleteQuiz(request.user.id, params.data.id);
      if (!deleted) return reply.code(404).send({ error: t(localeOf(request), "quizzes.notFound") });
      return reply.code(204).send();
    });

    app.post("/quizzes/:id/publish", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: t(localeOf(request), "quizzes.invalidId") });
      try {
        const outcome = service.publishQuiz(request.user.id, params.data.id);
        if (!outcome.ok) {
          if (outcome.reason === "not-found") return reply.code(404).send({ error: t(localeOf(request), "quizzes.notFound") });
          if (outcome.reason === "already-published") return reply.code(409).send({ error: t(localeOf(request), outcome.error) });
          return reply.code(400).send({ error: t(localeOf(request), outcome.error) });
        }
        return reply.code(201).send({ quiz: quizToWorks(outcome.quiz, outcome.canonical), voteCode: outcome.quiz.voteCode });
      } catch (err) {
        return sendWorksError(request, reply, err);
      }
    });

    app.put("/quizzes/:id/voting", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: t(localeOf(request), "quizzes.invalidId") });
      const body = playStateSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: validationMessage(localeOf(request), body.error) });
      const owned = service.getQuiz(request.user.id, params.data.id);
      if (!owned) return reply.code(404).send({ error: t(localeOf(request), "quizzes.notFound") });
      try {
        const known = canonicalForQuiz(owned);
        const quiz = service.setPlayState(request.user.id, params.data.id, body.data.open);
        if (!quiz) return reply.code(404).send({ error: t(localeOf(request), "quizzes.notFound") });
        return reply.send({ quiz: quizToWorks(quiz, known) });
      } catch (err) {
        return sendWorksError(request, reply, err);
      }
    });

    app.get("/quizzes/:id/results", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: t(localeOf(request), "quizzes.invalidId") });
      // getResults is ownership-checked inside the service; undefined here
      // can only mean "not found or not owned".
      const results = service.getResults(request.user.id, params.data.id);
      if (!results) return reply.code(404).send({ error: t(localeOf(request), "quizzes.notFound") });
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
      if (!params.success) return reply.code(404).send({ error: t(localeOf(request), "quizzes.noQuizAtLink") });
      const board = service.getPlayBoard(params.data.code);
      if (!board) return reply.code(404).send({ error: t(localeOf(request), "quizzes.noQuizAtLink") });
      return reply.send({ board });
    });

    app.post("/quizzes/voting/:code/play", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      const body = playSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: t(localeOf(request), "quizzes.invalidPlay") });
      }
      const outcome = service.submitPlay(params.data.code, body.data.answers, body.data.durationMs, body.data.playerName ?? null, playerFor(request, null));
      return sendPlayOutcome(request, reply, outcome);
    });

    // Two shapes because the caller may hold either half of what playerFor
    // needs: an anonymous player has only the play id their device stored,
    // while a signed-in one is resolved from their account and never has
    // an id to send (same split as tierlists' readBallot).
    const readPlay = async (request: FastifyRequest, reply: FastifyReply) => {
      const params = codeParamSchema.safeParse(request.params);
      const playId = (request.params as { playId?: string }).playId ?? null;
      if (!params.success) return reply.code(404).send({ error: t(localeOf(request), "quizzes.noQuizAtLink") });
      const outcome = service.getPlay(params.data.code, playerFor(request, playId));
      return sendPlayOutcome(request, reply, outcome);
    };
    app.get("/quizzes/voting/:code/play", readPlay);
    app.get("/quizzes/voting/:code/play/:playId", readPlay);

    app.get("/quizzes/voting/:code/results", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: t(localeOf(request), "quizzes.noQuizAtLink") });
      const { playId } = request.query as { playId?: unknown };
      const results = service.getPublicResults(params.data.code, playerFor(request, typeof playId === "string" ? playId : null));
      if (!results) return reply.code(404).send({ error: t(localeOf(request), "quizzes.noQuizAtLink") });
      reply.header("Cache-Control", "no-store");
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

function sendPlayOutcome(request: FastifyRequest, reply: FastifyReply, outcome: PlayOutcome) {
  if (!outcome.ok) {
    const locale = localeOf(request);
    if (outcome.reason === "not-found") return reply.code(404).send({ error: t(locale, "quizzes.noQuizAtLink") });
    if (outcome.reason === "closed") return reply.code(403).send({ error: t(locale, "quizzes.notOpen") });
    if (outcome.reason === "already-played") return reply.code(409).send({ error: t(locale, "quizzes.alreadyPlayed") });
    return reply.code(400).send({ error: t(locale, "quizzes.answersMismatch") });
  }
  return reply.send({ playId: outcome.playId, score: outcome.score, correct: outcome.correct, answers: outcome.answers } satisfies PlayResponse);
}
