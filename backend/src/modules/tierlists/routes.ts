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
import { sendWorksError, worksFormat } from "../../worksFormat.js";
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { canonicalByKey, duplicateWorkMessage, firstDuplicateWork, firstKeyPerWork, resolveEntryWorks, resolvePublicLibraryData, WorkResolutionError, workIdsByKey } from "../library/index.js";
import { boardKeys } from "./domain/boardKeys.js";
import type { Tierlist } from "./domain/types.js";
import type { BallotOutcome, TierlistsService, Voter } from "./service.js";
import { boardKeysInOrder, histogramToWorks, keyedBoard, tierlistToWorks } from "./wire.js";
import { InvalidShareImageError, MAX_SHARE_IMAGE_BYTES, renderShareVideo, ShareVideoRenderError } from "./shareVideo.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const createTierlistSchema = z.object({
  name: z.string().trim().min(1, "name is required and must be non-empty.").max(200),
  data: z.object({
    tiers: z.array(z.object({ id: z.string().min(1), label: z.string().trim().min(1).max(30), color: z.string().regex(/^#[0-9a-f]{6}$/i), bookKeys: z.array(z.string().min(1)) })).min(1),
    pool: z.array(z.string().min(1)).max(500)
  }).optional(),
  access: z.enum(["anonymous", "members"]).optional()
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

const worksTierSchema = z.object({ id: z.string().min(1), label: z.string().trim().min(1).max(30), color: z.string().regex(/^#[0-9a-f]{6}$/i), workIds: z.array(z.string().min(1)) });

const worksBoardSchema = z.object({ tiers: z.array(worksTierSchema), pool: z.array(z.string().min(1)).max(500) });

const createWorksSchema = z.object({
  name: z.string().trim().min(1, "name is required and must be non-empty.").max(200),
  data: worksBoardSchema.extend({ tiers: z.array(worksTierSchema).min(1) }).optional(),
  access: z.enum(["anonymous", "members"]).optional()
});

const updateWorksSchema = z
  .object({ name: z.string().min(1).optional(), data: worksBoardSchema.optional() })
  .refine((body) => body.name !== undefined || body.data !== undefined, { message: "At least one of name or data must be provided." });

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

function withWorks(service: TierlistsService, tierlist: Tierlist, works: boolean): Tierlist {
  return works ? tierlistToWorks(tierlist, service.storedWorks(tierlist.id)) : tierlist;
}

type ResolveBoardWorks = typeof resolveEntryWorks;

function resolveBoard(resolveWorks: ResolveBoardWorks, userId: string, data: unknown): { works: Map<string, string | null> } | { status: 409 | 503; error: string } {
  const keys = boardKeys(data);
  try {
    const refs = resolveWorks(userId, keys.map((key) => ({ key })));
    const duplicate = firstDuplicateWork(keys, refs);
    if (duplicate) return { status: 409, error: duplicateWorkMessage(duplicate) };
    return { works: workIdsByKey(keys, refs) };
  } catch (err) {
    if (err instanceof WorkResolutionError) return { status: 503, error: err.message };
    throw err;
  }
}

export function buildTierlistRoutes(service: TierlistsService, resolveWorks: ResolveBoardWorks = resolveEntryWorks) {
  return async function tierlistRoutes(app: FastifyInstance) {
    app.get("/tierlists", { preHandler: authGuard }, async (request, reply) => {
      const works = worksFormat(request, reply);
      return reply.send({ tierlists: service.listTierlists(request.user.id).map((tierlist) => withWorks(service, tierlist, works)) });
    });

    app.get("/tierlists/voted", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ tierlists: service.listVotedByUser(request.user.id) });
    });

    app.post("/tierlists", { preHandler: authGuard }, async (request, reply) => {
      if (worksFormat(request, reply)) {
        const parsed = createWorksSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        const { name, data, access } = parsed.data;
        if (access && !data) return reply.code(400).send({ error: "Choose books and tiers before publishing." });
        if (data) {
          const ids = data.tiers.map((tier) => tier.id);
          if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: "Duplicate tier or book." });
          if (access && (!data.pool.length || data.tiers.some((tier) => tier.workIds.length))) return reply.code(400).send({ error: "Public tier lists need an unranked book pool." });
        }
        try {
          const keyed = data ? keyedBoard(request.user.id, data, undefined, new Map()) : undefined;
          if (keyed && keyed.status !== undefined) return reply.code(keyed.status).send({ error: keyed.error });
          const keys = keyed ? [...new Set([...keyed.data.pool, ...keyed.data.tiers.flatMap((tier) => tier.bookKeys)])] : [];
          const publicBooks = access ? resolvePublicLibraryData(request.user.id, { bookKeys: keys, highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [] }).books : [];
          if (access && publicBooks.length !== keys.length) return reply.code(400).send({ error: "A selected book is no longer in your library." });
          const tierlist = service.createTierlist(request.user.id, name, keyed?.data, access, publicBooks, keyed?.works);
          return reply.code(201).send(withWorks(service, tierlist, true));
        } catch (err) {
          return sendWorksError(reply, err);
        }
      }
      const parsed = createTierlistSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      const { name, data, access } = parsed.data;
      if (access && !data) return reply.code(400).send({ error: "Choose books and tiers before publishing." });
      if (data) {
        const ids = data.tiers.map((tier) => tier.id);
        const allKeys = [...data.pool, ...data.tiers.flatMap((tier) => tier.bookKeys)];
        if (new Set(ids).size !== ids.length || new Set(allKeys).size !== allKeys.length) return reply.code(400).send({ error: "Duplicate tier or book." });
        if (access && (!data.pool.length || data.tiers.some((tier) => tier.bookKeys.length))) return reply.code(400).send({ error: "Public tier lists need an unranked book pool." });
      }
      const keys = data ? [...new Set([...data.pool, ...data.tiers.flatMap((tier) => tier.bookKeys)])] : [];
      const publicBooks = access ? resolvePublicLibraryData(request.user.id, { bookKeys: keys, highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [] }).books : [];
      if (access && publicBooks.length !== keys.length) return reply.code(400).send({ error: "A selected book is no longer in your library." });
      const board = data ? resolveBoard(resolveWorks, request.user.id, data) : undefined;
      if (board && "error" in board) return reply.code(board.status).send({ error: board.error });
      const tierlist = service.createTierlist(request.user.id, name, data, access, publicBooks, board?.works);
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
      return reply.send(withWorks(service, tierlist, worksFormat(request, reply)));
    });

    app.put("/tierlists/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      if (worksFormat(request, reply)) {
        const body = updateWorksSchema.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
        try {
          let keyed: ReturnType<typeof keyedBoard> | undefined;
          if (body.data.data !== undefined) {
            const owned = service.getTierlist(request.user.id, params.data.id);
            if (!owned || owned.voteCode !== null) return reply.code(404).send({ error: "No tier list with that id." });
            const result = keyedBoard(request.user.id, body.data.data, owned.data, service.storedWorks(owned.id));
            if (result.status !== undefined) return reply.code(result.status).send({ error: result.error });
            keyed = result;
          }
          const tierlist = service.updateTierlist(request.user.id, params.data.id, { ...(body.data.name !== undefined ? { name: body.data.name } : {}), ...(keyed ? { data: keyed.data } : {}) }, keyed?.works);
          if (!tierlist) return reply.code(404).send({ error: "No tier list with that id." });
          return reply.send(withWorks(service, tierlist, true));
        } catch (err) {
          return sendWorksError(reply, err);
        }
      }
      const body = updateTierlistSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      let works: Map<string, string | null> | undefined;
      if (body.data.data !== undefined && service.getTierlist(request.user.id, params.data.id)?.voteCode === null) {
        const board = resolveBoard(resolveWorks, request.user.id, body.data.data);
        if ("error" in board) return reply.code(board.status).send({ error: board.error });
        works = board.works;
      }
      const tierlist = service.updateTierlist(request.user.id, params.data.id, body.data, works);
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
      const works = worksFormat(request, reply);
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const body = openVotingSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      const owned = service.getTierlist(request.user.id, params.data.id);
      if (!owned) return reply.code(404).send({ error: "No tier list with that id." });
      const data = owned.data as { pool?: string[]; tiers?: Array<{ bookKeys?: string[] }> };
      const keys = [...new Set([...(data.pool ?? []), ...(data.tiers ?? []).flatMap((tier) => tier.bookKeys ?? [])])];
      const publicBooks = resolvePublicLibraryData(request.user.id, { bookKeys: keys, highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [] }).books;
      const tierlist = service.openVoting(request.user.id, params.data.id, body.data.access, publicBooks);
      if (!tierlist) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      return reply.code(201).send({ tierlist: withWorks(service, tierlist, works), voteCode: tierlist.voteCode });
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
      return reply.send({ tierlist: withWorks(service, tierlist, worksFormat(request, reply)) });
    });

    app.get("/tierlists/:id/results", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      // Ownership-checked BEFORE reading results: getResults takes a plain
      // tier list id, so without this an authenticated user could read any
      // poll's raw histogram by id.
      const owned = service.getTierlist(request.user.id, params.data.id);
      if (!owned) {
        return reply.code(404).send({ error: "No tier list with that id." });
      }
      const results = service.getResults(params.data.id);
      if (!worksFormat(request, reply)) return reply.send(results);
      const stored = canonicalByKey(service.storedWorks(owned.id));
      const first = new Set(firstKeyPerWork(boardKeysInOrder(owned.data), stored).values());
      return reply.send({ histogram: histogramToWorks(results.histogram, stored, first), ballotCount: results.ballotCount });
    });
  };
}

export function buildTierlistShareVideoRoutes(service: TierlistsService) {
  return async function tierlistShareVideoRoutes(app: FastifyInstance) {
    app.post("/tierlists/:id/share-video", { preHandler: authGuard, bodyLimit: MAX_SHARE_IMAGE_BYTES + 2048 }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tier list id." });
      const tierlist = service.getTierlist(request.user.id, params.data.id);
      if (!tierlist?.voteCode) return reply.code(404).send({ error: "No public tier list with that id." });

      const upload = await request.file();
      if (!upload || upload.fieldname !== "image") return reply.code(400).send({ error: "Upload a PNG in the image field." });
      const image = await upload.toBuffer();
      try {
        const video = await renderShareVideo(image);
        reply.header("Cache-Control", "no-store");
        return reply.send({ base64: video.toString("base64") });
      } catch (error) {
        if (error instanceof InvalidShareImageError) return reply.code(400).send({ error: error.message });
        if (error instanceof ShareVideoRenderError) {
          request.log.error(error);
          return reply.code(500).send({ error: error.message });
        }
        throw error;
      }
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
      const libraryData = board.publicBooks !== null ? { books: board.publicBooks } : resolvePublicLibraryData(board.ownerUserId, {
        bookKeys: board.pool,
        highlightRefs: [],
        needsCurrentlyReading: false,
        statsMetrics: []
      });

      // board.ownerUserId is deliberately NOT spread into the response.
      //
      // Results-after-you-submit is enforced HERE, not just in the UI: while
      // voting is open the per-book/per-tier histogram is omitted entirely,
      // so a plain curl of this route can't hand someone the standings
      // before they vote. A voter gets the histogram back in the ballot
      // submit/edit response instead, and the owner reads it through the
      // ownership-checked GET /tierlists/:id/results. Once voting is closed
      // the final result IS the point, so it's included. ballotCount stays
      // in both cases — the public directory already publishes it.
      return reply.send({
        board: {
          name: board.name,
          tiers: board.tiers,
          pool: board.pool,
          access: board.access,
          votingOpen: board.votingOpen,
          ballotCount: board.ballotCount,
          eligibleVoteCount: board.eligibleVoteCount,
          promotedAt: board.promotedAt,
          ...(board.votingOpen ? {} : { histogram: board.histogram })
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

    // Two shapes because the caller may hold either half of what voterFor
    // needs: an anonymous voter has only the ballot id their device stored,
    // while a signed-in one is resolved from their account and never has an
    // id to send — openVoting seeded their ballot server-side.
    const readBallot = async (request: FastifyRequest, reply: FastifyReply) => {
      const params = codeParamSchema.safeParse(request.params);
      const ballotId = (request.params as { ballotId?: string }).ballotId ?? null;
      if (!params.success) {
        return reply.code(404).send({ error: "No ballot at that link." });
      }
      const outcome = service.getBallot(params.data.code, voterFor(request, ballotId));
      return sendBallotOutcome(reply, service, params.data.code, outcome);
    };
    app.get("/tierlists/voting/:code/ballot", readBallot);
    app.get("/tierlists/voting/:code/ballot/:ballotId", readBallot);
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
