import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { CommunityError, InvalidCursorError, ProfileNotFoundError } from "./domain/errors.js";
import type { CommunityService } from "./service.js";

const followSchema = z.object({ userId: z.string().min(1) });
const publishSchema = z.object({ muralId: z.string().min(1) });
const dashboardQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});
const peopleQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});
const discoverQuerySchema = z.object({
  type: z.enum(["all", "tierlist", "tournament"]).default("all"),
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});
const feedSettingsSchema = z.object({ publications: z.boolean(), reading: z.boolean(), votes: z.boolean(), follows: z.boolean() });
const activityQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

function statusForCommunityError(err: CommunityError): number {
  if (err instanceof ProfileNotFoundError) return 404;
  if (err instanceof InvalidCursorError) return 400;
  return 400;
}

export function buildCommunityRoutes(service: CommunityService) {
  return async function communityRoutes(app: FastifyInstance) {
    app.post("/community/follows", { preHandler: authGuard }, async (request, reply) => {
      const parsed = followSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {userId}." });
      try {
        service.follow(request.user.id, parsed.data.userId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.delete("/community/follows/:userId", { preHandler: authGuard }, async (request, reply) => {
      const { userId } = request.params as { userId: string };
      try {
        service.unfollow(request.user.id, userId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.put("/community/profile/publish", { preHandler: authGuard }, async (request, reply) => {
      const parsed = publishSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {muralId}." });
      try {
        service.publishProfile(request.user.id, parsed.data.muralId);
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.delete("/community/profile/publish", { preHandler: authGuard }, async (request, reply) => {
      service.unpublishProfile(request.user.id);
      return reply.code(204).send();
    });

    app.get("/community/profile", { preHandler: authGuard }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.send(service.getOwnProfile(request.user.id));
    });

    app.put("/community/profile/mural", { preHandler: authGuard }, async (request, reply) => {
      const parsed = publishSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected {muralId}." });
      try {
        service.setShelfMural(request.user.id, parsed.data.muralId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.put("/community/profile/feed-settings", { preHandler: authGuard }, async (request, reply) => {
      const parsed = feedSettingsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Expected { publications, reading, votes, follows } booleans." });
      service.updateFeedSettings(request.user.id, parsed.data);
      return reply.code(204).send();
    });

    app.get("/community/dashboard", { preHandler: authGuard }, async (request, reply) => {
      const parsed = dashboardQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid cursor/limit." });
      try {
        return reply.send(service.getDashboard(request.user.id, parsed.data.cursor, parsed.data.limit));
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.post("/community/dashboard/seen", { preHandler: authGuard }, async (request, reply) => {
      service.markDashboardSeen(request.user.id);
      return reply.code(204).send();
    });

    app.get("/community/people", { preHandler: authGuard }, async (request, reply) => {
      const parsed = peopleQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Expected ?q= and optional ?limit=." });
      return reply.send({ people: service.searchPeople(request.user.id, parsed.data.q, parsed.data.limit) });
    });
  };
}

export function buildPublicCommunityRoutes(service: CommunityService) {
  return async function publicCommunityRoutes(app: FastifyInstance) {
    app.get("/community/profiles/:username", async (request, reply) => {
      const { username } = request.params as { username: string };
      try {
        const viewer = getOptionalAuthenticatedUser(request);
        const view = service.getProfileByUsername(username, viewer?.id);
        reply.header("Cache-Control", "no-store");
        return reply.send(view);
      } catch (err) {
        if (err instanceof ProfileNotFoundError) return reply.code(404).send({ error: "No published profile at that address." });
        throw err;
      }
    });

    app.get("/community/profiles/:username/activity", async (request, reply) => {
      const { username } = request.params as { username: string };
      const parsed = activityQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid activity query." });
      try {
        const viewer = getOptionalAuthenticatedUser(request);
        const page = service.getActivity(username, viewer?.id, parsed.data.cursor, parsed.data.limit);
        reply.header("Cache-Control", "no-store");
        return reply.send(page);
      } catch (err) {
        if (err instanceof CommunityError) return reply.code(statusForCommunityError(err)).send({ error: err.message });
        throw err;
      }
    });

    app.get("/community/profiles/:username/library", async (request, reply) => {
      const { username } = request.params as { username: string };
      try {
        const library = service.getLibrary(username);
        reply.header("Cache-Control", "no-store");
        return reply.send(library);
      } catch (err) {
        if (err instanceof ProfileNotFoundError) return reply.code(404).send({ error: "No published profile at that address." });
        throw err;
      }
    });

    app.get("/community/discover", async (request, reply) => {
      const parsed = discoverQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid type/q/limit/offset." });
      reply.header("Cache-Control", "no-store");
      const viewer = getOptionalAuthenticatedUser(request);
      return reply.send(service.getDiscover(parsed.data.type, parsed.data.q, parsed.data.limit, parsed.data.offset, viewer?.id));
    });
  };
}
