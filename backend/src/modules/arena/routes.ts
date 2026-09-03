// HTTP layer for the arena module: request validation and mapping
// service results to responses. No business logic here — see service.ts.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import {
  AlreadyVotedError,
  ArenaError,
  DuelNotFoundError,
  TournamentAlreadyStartedError,
  TournamentNotFoundError
} from "./domain/errors.js";
import type { ArenaService } from "./service.js";

function statusForArenaError(err: ArenaError): number {
  if (err instanceof TournamentNotFoundError || err instanceof DuelNotFoundError) return 404;
  if (err instanceof AlreadyVotedError) return 409;
  if (err instanceof TournamentAlreadyStartedError) return 409;
  return 400;
}

const idParamSchema = z.object({ id: z.string().uuid() });
const duelParamSchema = z.object({ id: z.string().uuid(), duelId: z.string().uuid() });

const seedBookSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
  cover: z.string().url().nullable().optional().transform((v) => v ?? null)
});

const createTournamentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  bracketSize: z.number().int().min(2).max(128),
  roundDurationMinutes: z.number().int().min(1).max(60 * 24 * 30)
});

// Name only. Everything else about a tournament is fixed at creation:
// `bracketSize` lays out the slots and duels, so changing it would mean
// rebuilding both, and `roundDurationMinutes` drives deadlines already
// written onto live duels.
const renameTournamentSchema = z.object({ name: z.string().trim().min(1).max(200) });

const setSlotsSchema = z.object({
  slots: z.array(z.object({ slotIndex: z.number().int().min(0), book: seedBookSchema }))
});

const randomFillSchema = z.object({ pool: z.array(seedBookSchema).min(1) });

const voteSchema = z.object({ voterToken: z.string().min(1).max(100), bookKey: z.string().min(1) });

const tiebreakSchema = z.object({ winnerBookKey: z.string().min(1) });

const listPublicQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

const getTournamentQuerySchema = z.object({ voterToken: z.string().min(1).max(100).optional() });

export function buildArenaRoutes(service: ArenaService) {
  return async function arenaRoutes(app: FastifyInstance) {
    app.post("/arenas", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createTournamentSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {name, bracketSize, roundDurationMinutes}." });
      try {
        const tournament = service.createTournament(request.user.id, parsed.data);
        return reply.code(201).send({ tournament });
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.get("/arenas/mine", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ tournaments: service.listMine(request.user.id) });
    });

    app.get("/arenas/public", async (request, reply) => {
      const parsed = listPublicQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid limit/offset." });
      return reply.send({ tournaments: service.listPublic(parsed.data.limit, parsed.data.offset) });
    });

    // Deliberately NOT behind authGuard — the whole point of BookArena is
    // that anyone with the link can view and vote. ownerUserId is a
    // plain opaque id in the response (not sensitive — same trust level
    // already used elsewhere), so the frontend can compute "am I the
    // owner" itself against its own session, with no new auth primitive
    // needed here.
    app.get("/arenas/:id", async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      const query = getTournamentQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: "Invalid voterToken." });
      const tournament = service.getTournamentView(params.data.id, query.data.voterToken);
      if (!tournament) return reply.code(404).send({ error: "No such tournament." });
      return reply.send({ tournament });
    });

    app.put("/arenas/:id/slots", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      const body = setSlotsSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected {slots: [{slotIndex, book}, ...]}." });
      try {
        service.setSlotsManual(params.data.id, request.user.id, body.data.slots);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.post("/arenas/:id/random-fill", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      const body = randomFillSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected {pool: [book, ...]}." });
      try {
        service.randomFill(params.data.id, request.user.id, body.data.pool);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.post("/arenas/:id/start", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      try {
        service.start(params.data.id, request.user.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.patch("/arenas/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      const parsed = renameTournamentSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {name}." });
      try {
        service.renameTournament(params.data.id, request.user.id, parsed.data.name);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.delete("/arenas/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      try {
        service.deleteTournament(params.data.id, request.user.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.post("/arenas/:id/duels/:duelId/settle", { preHandler: authGuard }, async (request, reply) => {
      const params = duelParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid id." });
      try {
        service.settleEarly(params.data.id, request.user.id, params.data.duelId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.post("/arenas/:id/duels/:duelId/tiebreak", { preHandler: authGuard }, async (request, reply) => {
      const params = duelParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid id." });
      const body = tiebreakSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected {winnerBookKey}." });
      try {
        service.tiebreak(params.data.id, request.user.id, params.data.duelId, body.data.winnerBookKey);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });
  };
}

// Registered in its OWN Fastify encapsulation scope (plugin.ts) so it can
// carry its own rate limit, independent of every other /arenas route —
// same reasoning as modules/covers/plugin.ts's two-scopes split: this is
// the app's first anonymous (unauthenticated) WRITE endpoint, worth
// protecting on its own rather than sharing a limit with authed routes.
export function buildVoteRoute(service: ArenaService) {
  return async function voteRoute(app: FastifyInstance) {
    app.post("/arenas/:id/duels/:duelId/vote", async (request, reply) => {
      const params = duelParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid id." });
      const body = voteSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Expected {voterToken, bookKey}." });
      try {
        service.vote(params.data.id, params.data.duelId, body.data.voterToken, body.data.bookKey);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
    });
  };
}
