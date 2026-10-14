import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authGuard, rateLimitKey } from "../auth/index.js";
import { CommunityError, ProfileNotFoundError } from "./domain/errors.js";
import type { EngagementService } from "./engagement.js";

const id = z.string().min(1).max(100);
const params = z.object({ id });
const ref = z.discriminatedUnion("kind", [z.object({ kind: z.literal("tierlist"), id }), z.object({ kind: z.literal("tournament"), id }), z.object({ kind: z.literal("quiz"), id }), z.object({ kind: z.literal("mural"), id, ownerId: id })]);
const page = z.object({ cursor: z.string().min(1).max(200).optional(), limit: z.coerce.number().int().min(1).max(50).default(25) });
const ids = z.object({ ids: z.array(id).min(1).max(50) });
const refs = z.object({ refs: z.array(ref).min(1).max(50) });
const like = z.object({ liked: z.boolean() });
const comment = z.object({ text: z.string().trim().min(1).max(1500) });
const saved = z.object({ ref, saved: z.boolean() });

function guarded(reply: FastifyReply, work: () => unknown) {
  try { return work(); }
  catch (error) {
    if (error instanceof CommunityError) return reply.code(error instanceof ProfileNotFoundError ? 404 : 400).send({ error: error instanceof ProfileNotFoundError ? "This activity is unavailable." : error.message });
    throw error;
  }
}

export function buildEngagementRoutes(service: EngagementService) {
  return async function engagementRoutes(app: FastifyInstance) {
    await app.register(fastifyRateLimit, { max: 60, timeWindow: "1 minute", keyGenerator: rateLimitKey });
    app.addHook("preHandler", authGuard);
    app.addHook("onRequest", (_request, reply, done) => { reply.header("Cache-Control", "no-store"); done(); });
    app.post("/community/activity/engagement", async (request, reply) => {
      const input = ids.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: "Expected 1–50 activity IDs." });
      return guarded(reply, () => service.getEngagement(request.user.id, input.data.ids));
    });
    app.put("/community/activity/:id/like", async (request, reply) => {
      const input = like.safeParse(request.body);
      const target = params.safeParse(request.params);
      if (!input.success || !target.success) return reply.code(400).send({ error: "Expected an activity ID and {liked}." });
      return guarded(reply, () => service.setLiked(request.user.id, target.data.id, input.data.liked));
    });
    app.get("/community/activity/:id/comments", async (request, reply) => {
      const query = page.safeParse(request.query);
      const target = params.safeParse(request.params);
      if (!query.success || !target.success) return reply.code(400).send({ error: "Invalid activity ID or page." });
      return guarded(reply, () => service.getComments(request.user.id, target.data.id, query.data.cursor, query.data.limit));
    });
    app.post("/community/activity/:id/comments", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
      const input = comment.safeParse(request.body);
      const target = params.safeParse(request.params);
      if (!input.success || !target.success) return reply.code(400).send({ error: "Write a comment of 1–1500 characters." });
      return guarded(reply, () => { service.addComment(request.user.id, target.data.id, input.data.text); return reply.code(204).send(); });
    });
    app.delete("/community/activity/comments/:id", async (request, reply) => {
      const target = params.safeParse(request.params);
      if (!target.success) return reply.code(400).send({ error: "Invalid comment ID." });
      return guarded(reply, () => { service.deleteComment(request.user.id, target.data.id); return reply.code(204).send(); });
    });
    app.post("/community/saved/state", async (request, reply) => {
      const input = refs.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: "Expected 1–50 content references." });
      return guarded(reply, () => service.getSavedState(request.user.id, input.data.refs));
    });
    app.put("/community/saved", async (request, reply) => {
      const input = saved.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: "Expected {ref, saved}." });
      return guarded(reply, () => { service.setSaved(request.user.id, input.data.ref, input.data.saved); return reply.code(204).send(); });
    });
    app.get("/community/saved", async (request, reply) => {
      const query = page.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: "Invalid saved content page." });
      return guarded(reply, () => service.getSaved(request.user.id, query.data.cursor, query.data.limit));
    });
  };
}
