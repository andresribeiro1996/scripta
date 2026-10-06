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
import { sendWorksError } from "../../worksFormat.js";
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { duplicateWorkMessage, firstKeyPerWork, knownWorkIds, resolvePublicBooksByWork, UnknownWorkError } from "../library/index.js";
import { boardWorks } from "./domain/boardKeys.js";
import type { Tierlist } from "./domain/types.js";
import type { BallotOutcome, TierlistsService, Voter } from "./service.js";
import { boardBooks, boardCanonical, canonicalBoard, canonicalFirst, histogramToWorks, placementsFromWorks, placementsToWorks, type WorksBoard } from "./wire.js";
import { InvalidShareImageError, MAX_SHARE_IMAGE_BYTES, renderShareVideo, ShareVideoRenderError } from "./shareVideo.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const worksTierSchema = z.object({ id: z.string().min(1), label: z.string().trim().min(1).max(30), color: z.string().regex(/^#[0-9a-f]{6}$/i), workIds: z.array(z.string().min(1)) });

const worksBoardSchema = z.object({ tiers: z.array(worksTierSchema), pool: z.array(z.string().min(1)).max(500) });

const createTierlistSchema = z.object({
  name: z.string().trim().min(1, "name is required and must be non-empty.").max(200),
  data: worksBoardSchema.extend({ tiers: z.array(worksTierSchema).min(1) }).optional(),
  access: z.enum(["anonymous", "members"]).optional()
});

const updateTierlistSchema = z
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
  placements: z.array(z.object({ workId: z.string().min(1), tierId: z.string().min(1) })).max(500)
});

const listPublicQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

function answer(tierlist: Tierlist): Tierlist {
  return { ...tierlist, data: canonicalBoard(tierlist.data) };
}

function storedBoard(board: WorksBoard): { data: WorksBoard } | { status: 400 | 409; error: string } {
  const all = [...board.tiers.flatMap((tier) => tier.workIds), ...board.pool];
  if (new Set(all).size !== all.length) return { status: 400, error: "Duplicate tier or book." };
  const ids = knownWorkIds(all);
  if (new Set(ids).size !== ids.length) return { status: 409, error: duplicateWorkMessage({ workId: null, title: null }) };
  const canonical = new Map(all.map((id, index) => [id, ids[index]!]));
  const swap = (workIds: string[]) => workIds.map((id) => canonical.get(id)!);
  return { data: { tiers: board.tiers.map((tier) => ({ ...tier, workIds: swap(tier.workIds) })), pool: swap(board.pool) } };
}

function booksInOrder(ownerUserId: string, workIds: string[]): unknown[] {
  const found = resolvePublicBooksByWork(ownerUserId, workIds);
  return workIds.flatMap((id) => found.get(id) ?? []);
}

export function buildTierlistRoutes(service: TierlistsService) {
  return async function tierlistRoutes(app: FastifyInstance) {
    app.get("/tierlists", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ tierlists: service.listTierlists(request.user.id).map(answer) });
    });

    app.get("/tierlists/voted", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ tierlists: service.listVotedByUser(request.user.id) });
    });

    app.post("/tierlists", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createTierlistSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      const { name, data, access } = parsed.data;
      if (access && !data) return reply.code(400).send({ error: "Choose books and tiers before publishing." });
      if (data) {
        const ids = data.tiers.map((tier) => tier.id);
        if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: "Duplicate tier or book." });
        if (access && (!data.pool.length || data.tiers.some((tier) => tier.workIds.length))) return reply.code(400).send({ error: "Public tier lists need an unranked book pool." });
      }
      try {
        const board = data ? storedBoard(data) : undefined;
        if (board && "error" in board) return reply.code(board.status).send({ error: board.error });
        const publicBooks = access && board ? booksInOrder(request.user.id, board.data.pool) : [];
        if (access && board && publicBooks.length !== board.data.pool.length) return reply.code(400).send({ error: "A selected book is no longer in your library." });
        const tierlist = service.createTierlist(request.user.id, name, board?.data, access, publicBooks);
        return reply.code(201).send(board ? { ...tierlist, data: board.data } : tierlist);
      } catch (err) {
        return sendWorksError(reply, err);
      }
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
      return reply.send(answer(tierlist));
    });

    app.put("/tierlists/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid tier list id." });
      }
      const body = updateTierlistSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      try {
        let board: { data: WorksBoard } | undefined;
        const owned = service.getTierlist(request.user.id, params.data.id);
        if (body.data.data !== undefined) {
          if (!owned || owned.voteCode !== null) return reply.code(404).send({ error: "No tier list with that id." });
          const result = storedBoard(body.data.data);
          if ("error" in result) return reply.code(result.status).send({ error: result.error });
          board = result;
        }
        const data = board?.data ?? (owned ? canonicalBoard(owned.data) : undefined);
        const tierlist = service.updateTierlist(request.user.id, params.data.id, { ...(body.data.name !== undefined ? { name: body.data.name } : {}), ...(board ? { data: board.data } : {}) });
        if (!tierlist || !data) return reply.code(404).send({ error: "No tier list with that id." });
        return reply.send({ ...tierlist, data });
      } catch (err) {
        return sendWorksError(reply, err);
      }
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
      const owned = service.getTierlist(request.user.id, params.data.id);
      if (!owned) return reply.code(404).send({ error: "No tier list with that id." });
      try {
        const known = boardCanonical(owned.data);
        const tierlist = service.openVoting(request.user.id, params.data.id, body.data.access, booksInOrder(request.user.id, boardWorks(owned.data)));
        if (!tierlist) {
          return reply.code(404).send({ error: "No tier list with that id." });
        }
        return reply.code(201).send({ tierlist: { ...tierlist, data: canonicalBoard(tierlist.data, known) }, voteCode: tierlist.voteCode });
      } catch (err) {
        return sendWorksError(reply, err);
      }
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
      const owned = service.getTierlist(request.user.id, params.data.id);
      if (!owned) return reply.code(404).send({ error: "No tier list with that id." });
      try {
        const data = canonicalBoard(owned.data);
        const tierlist = service.setVotingState(request.user.id, params.data.id, body.data);
        if (!tierlist) {
          return reply.code(404).send({ error: "No tier list with that id." });
        }
        return reply.send({ tierlist: { ...tierlist, data } });
      } catch (err) {
        return sendWorksError(reply, err);
      }
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
      const { canonical, first } = canonicalFirst(boardWorks(owned.data));
      return reply.send({ histogram: histogramToWorks(results.histogram, canonical, first), ballotCount: results.ballotCount });
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

      // Same privacy boundary the shared-mural route enforces: work ids
      // become redacted public book shapes via library's own resolver,
      // never a raw read of the owner's library.
      const { canonical, first } = canonicalFirst(board.pool);
      const { pool } = canonicalBoard({ pool: board.pool });

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
          pool,
          access: board.access,
          votingOpen: board.votingOpen,
          ballotCount: board.ballotCount,
          eligibleVoteCount: board.eligibleVoteCount,
          promotedAt: board.promotedAt,
          ...(board.votingOpen ? {} : { histogram: histogramToWorks(board.histogram, canonical, first) })
        },
        books: boardBooks(pool, board.publicBooks, () => booksInOrder(board.ownerUserId, pool))
      });
    });

    const submitBallot = (request: FastifyRequest, reply: FastifyReply, ballotId: string | null) => {
      const params = codeParamSchema.safeParse(request.params);
      const body = placementsSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: "Invalid ballot." });
      }
      const board = service.getVotingBoard(params.data.code);
      if (!board) return reply.code(404).send({ error: "No tier list at that link." });
      try {
        const ids = knownWorkIds(body.data.placements.map((placement) => placement.workId));
        const view = canonicalFirst(board.pool);
        const placements = placementsFromWorks(body.data.placements, ids, firstKeyPerWork(board.pool, view.canonical));
        if (!placements) return reply.code(400).send({ error: "Those placements don't match this tier list." });
        const outcome = service.submitBallot(params.data.code, placements, voterFor(request, ballotId));
        return sendBallotOutcome(reply, service, params.data.code, outcome, () => view);
      } catch (err) {
        if (err instanceof UnknownWorkError) return reply.code(400).send({ error: "Those placements don't match this tier list." });
        return sendWorksError(reply, err);
      }
    };

    app.post("/tierlists/voting/:code/ballot", async (request, reply) => submitBallot(request, reply, null));

    app.put("/tierlists/voting/:code/ballot/:ballotId", async (request, reply) => {
      return submitBallot(request, reply, (request.params as { ballotId?: string }).ballotId ?? null);
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
      return sendBallotOutcome(reply, service, params.data.code, outcome, () => canonicalFirst(service.getVotingBoard(params.data.code)?.pool ?? []));
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

function sendBallotOutcome(reply: FastifyReply, service: TierlistsService, code: string, outcome: BallotOutcome, view: () => ReturnType<typeof canonicalFirst>) {
  if (!outcome.ok) {
    if (outcome.reason === "not-found") return reply.code(404).send({ error: "No tier list at that link." });
    if (outcome.reason === "closed") return reply.code(409).send({ error: "Voting is closed for this tier list." });
    if (outcome.reason === "members-only") return reply.code(401).send({ error: "Sign in to vote on this tier list." });
    return reply.code(400).send({ error: "Those placements don't match this tier list." });
  }
  const board = service.getVotingBoard(code);
  const { canonical, first } = view();
  return reply.send({
    ballotId: outcome.ballotId,
    placements: placementsToWorks(outcome.placements, canonical, first),
    results: { histogram: histogramToWorks(board?.histogram ?? [], canonical, first), ballotCount: board?.ballotCount ?? 0 }
  });
}
