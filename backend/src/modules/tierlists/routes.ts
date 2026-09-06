// HTTP layer for the tierlists module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// Cross-module dependency in action, same as modules/murals/routes.ts:
// authGuard comes from auth's PUBLIC interface only.
//
// "Not found or not owned" is a plain undefined/boolean check here, same
// convention as modules/murals/routes.ts's own /murals/:id routes — not a
// caught exception (see modules/murals/domain/errors.ts's counterpart
// comment for why a module like this doesn't use one for that case).

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { resolvePublicLibraryData } from "../library/index.js";
import type { BallotOutcome, TierlistsService, Voter } from "./service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const createTierlistSchema = z.object({
  name: z.string().min(1, "name is required and must be non-empty.")
});

// Deliberately light-touch, same treatment modules/murals/routes.ts gives
// its own opaque `blocks` blob: this only checks data is an object — it
// doesn't otherwise care what a tier list document looks like.
const updateTierlistSchema = z
  .object({
    name: z.string().min(1).optional(),
    data: z.record(z.unknown()).optional()
  })
  .refine((body) => body.name !== undefined || body.data !== undefined, {
    message: "At least one of name or data must be provided."
  });

const voteAccessSchema = z.enum(["anonymous", "members"]);

const openVotingSchema = z.object({ access: voteAccessSchema });

const votingStateSchema = z
  .object({ access: voteAccessSchema.optional(), open: z.boolean().optional() })
  .refine((body) => body.access !== undefined || body.open !== undefined, {
    message: "At least one of access or open must be provided."
  });

const codeParamSchema = z.object({ code: z.string().min(1).max(64) });

const placementsSchema = z.object({
  placements: z.array(z.object({ bookKey: z.string().min(1), tierId: z.string().min(1) })).max(500)
});

const listPublicQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export function buildTierlistRoutes(service: TierlistsService) {
  return async function tierlistRoutes(app: FastifyInstance) {
    app.get("/tierlists", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ tierlists: service.listTierlists(request.user.id) });
    });

    app.post("/tierlists", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createTierlistSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      const tierlist = service.createTierlist(request.user.id, parsed.data.name);
      return reply.code(201).send(tierlist);
    });

    app.get("/tierlists/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const tierlist = service.getTierlist(request.user.id, params.data.id);
      if (!tierlist) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.send(tierlist);
    });

    app.put("/tierlists/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const body = updateTierlistSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      const tierlist = service.updateTierlist(request.user.id, params.data.id, body.data);
      if (!tierlist) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.send(tierlist);
    });

    app.delete("/tierlists/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const deleted = service.deleteTierlist(request.user.id, params.data.id);
      if (!deleted) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.code(204).send();
    });

    app.post("/tierlists/:id/open-voting", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const body = openVotingSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      const tierlist = service.openVoting(request.user.id, params.data.id, body.data.access);
      if (!tierlist) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.code(201).send({ tierlist, voteCode: tierlist.voteCode });
    });

    app.put("/tierlists/:id/voting", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const body = votingStateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      const tierlist = service.setVotingState(request.user.id, params.data.id, body.data);
      if (!tierlist) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.send({ tierlist });
    });

    app.get("/tierlists/:id/results", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      // Ownership-checked BEFORE reading results: getResults takes a plain
      // tier list id, so without this an authenticated user could read any
      // poll's raw histogram by id.
      if (!service.getTierlist(request.user.id, params.data.id)) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.send(service.getResults(params.data.id));
    });
  };
}

/** The public, unauthenticated surface — the directory, the voting board,
 *  and ballots. Registered in its OWN Fastify encapsulation scope by
 *  plugin.ts specifically so it can carry a tight rate limit that the
 *  authenticated CRUD routes above must NOT inherit, exactly the split
 *  modules/murals/routes.ts makes for GET /murals/shared/:token.
 *
 *  The vote code is an identifier, not a secret: community tier lists are
 *  publicly listed, so nothing here is protected by the code being hard to
 *  guess. vote_access is what authorizes a ballot. */
export function buildPublicTierlistRoutes(service: TierlistsService) {
  return async function publicTierlistRoutes(app: FastifyInstance) {
    app.get("/tierlists/public", async (request, reply) => {
      const query = listPublicQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "Invalid limit/offset." });
      }
      return reply.send({ tierlists: service.listPublicTierlists(query.data.limit, query.data.offset) });
    });

    app.get("/tierlists/voting/:code", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(404).send({ error: "No tier list at that link." });
      }
      const board = service.getVotingBoard(params.data.code);
      if (!board) {
        return reply.code(404).send({ error: "No tier list at that link." });
      }

      // Same privacy boundary the shared-mural route enforces: book keys
      // become redacted public book shapes via library's own resolver,
      // never a raw read of the owner's library.
      const libraryData = resolvePublicLibraryData(board.ownerUserId, {
        bookKeys: board.pool,
        highlightRefs: [],
        needsCurrentlyReading: false,
        statsMetrics: []
      });

      // board.ownerUserId is deliberately NOT spread into the response.
      return reply.send({
        board: {
          name: board.name,
          tiers: board.tiers,
          pool: board.pool,
          access: board.access,
          votingOpen: board.votingOpen,
          ballotCount: board.ballotCount,
          histogram: board.histogram
        },
        books: libraryData.books
      });
    });

    app.post("/tierlists/voting/:code/ballot", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      const body = placementsSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: "Invalid ballot." });
      }
      const outcome = service.submitBallot(params.data.code, body.data.placements, voterFor(request, null));
      return sendBallotOutcome(reply, service, params.data.code, outcome);
    });

    app.put("/tierlists/voting/:code/ballot/:ballotId", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      const ballotId = (request.params as { ballotId?: string }).ballotId ?? null;
      const body = placementsSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: "Invalid ballot." });
      }
      const outcome = service.submitBallot(params.data.code, body.data.placements, voterFor(request, ballotId));
      return sendBallotOutcome(reply, service, params.data.code, outcome);
    });

    app.get("/tierlists/voting/:code/ballot/:ballotId", async (request, reply) => {
      const params = codeParamSchema.safeParse(request.params);
      const ballotId = (request.params as { ballotId?: string }).ballotId ?? null;
      if (!params.success) {
        return reply.code(404).send({ error: "No ballot at that link." });
      }
      const outcome = service.getBallot(params.data.code, voterFor(request, ballotId));
      return sendBallotOutcome(reply, service, params.data.code, outcome);
    });
  };
}

/** A signed-in caller always votes as their account (the DB's partial
 *  unique index is the authority on one-ballot-per-account); everyone else
 *  votes as the ballot id their browser is holding. */
function voterFor(request: FastifyRequest, ballotId: string | null): Voter {
  const user = getOptionalAuthenticatedUser(request);
  return user ? { kind: "user", userId: user.id } : { kind: "anonymous", ballotId };
}

function sendBallotOutcome(reply: FastifyReply, service: TierlistsService, code: string, outcome: BallotOutcome) {
  if (!outcome.ok) {
    if (outcome.reason === "not-found") return reply.code(404).send({ error: "No tier list at that link." });
    if (outcome.reason === "closed") return reply.code(409).send({ error: "Voting is closed for this tier list." });
    if (outcome.reason === "members-only") return reply.code(401).send({ error: "Sign in to vote on this tier list." });
    return reply.code(400).send({ error: "Those placements don't match this tier list." });
  }
  const board = service.getVotingBoard(code);
  return reply.send({
    ballotId: outcome.ballotId,
    placements: outcome.placements,
    results: { histogram: board?.histogram ?? [], ballotCount: board?.ballotCount ?? 0 }
  });
}
