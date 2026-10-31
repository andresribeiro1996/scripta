import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { authGuard, getOptionalAuthenticatedUser } from "../auth/index.js";
import { DailyChapterError } from "./domain/dailyChapter.js";
import { dailyGuestKey, type DailyChapterService } from "./dailyChapterService.js";
import { dailyPlayerSchema, dailyPlaySchema } from "./dailyChapterValidation.js";

const playerIdSchema = z.string().min(1).max(100);

function signedIn(request: FastifyRequest) {
  const user = getOptionalAuthenticatedUser(request);
  if (request.headers.authorization && !user) throw new DailyChapterError(401, "Sign in again to load your daily history.");
  return user;
}

function player(request: FastifyRequest, guestId?: string): string {
  const user = signedIn(request);
  if (user) return user.id;
  if (!guestId) throw new DailyChapterError(400, "A device identity is required to save your result.");
  return dailyGuestKey(guestId);
}

export function buildDailyChapterRoutes(service: DailyChapterService, isAdmin: (userId: string) => boolean) {
  return async function dailyChapterRoutes(app: FastifyInstance) {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof DailyChapterError) return reply.code(error.status).send({ error: error.message });
      if (error instanceof ZodError) return reply.code(400).send({ error: error.issues[0]?.message ?? "Invalid daily chapter data." });
      throw error;
    });
    const admin = [authGuard, async (request: FastifyRequest) => { if (!isAdmin(request.user.id)) throw new DailyChapterError(403, "Only the editor can manage daily editions."); }];
    app.get("/daily-chapter/today", async (_request, reply) => reply.header("Cache-Control", "no-store").send(service.today()));
    app.post("/daily-chapter/history", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
      const body = dailyPlayerSchema.parse(request.body);
      return reply.header("Cache-Control", "no-store").send(service.history(player(request, body.guestId), body.guestId));
    });
    app.post<{ Params: { id: string } }>("/daily-chapter/:id/play", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
      const body = dailyPlaySchema.parse(request.body);
      return reply.header("Cache-Control", "no-store").send(service.play(request.params.id, player(request, body.guestId), body.answers));
    });
    app.get<{ Params: { id: string } }>("/daily-chapter/:id/people", { preHandler: authGuard }, async (request, reply) => reply.header("Cache-Control", "no-store").send({ people: service.people(request.params.id, request.user.id) }));
    app.get<{ Params: { userId: string } }>("/daily-chapter/players/:userId", async (request, reply) => {
      const userId = playerIdSchema.parse(request.params.userId);
      return reply.header("Cache-Control", "no-store").send({ summary: service.player(userId, signedIn(request)?.id ?? null) });
    });
    app.get("/daily-chapter/admin", { preHandler: admin }, async (_request, reply) => reply.header("Cache-Control", "no-store").send(service.editorial()));
    app.put("/daily-chapter/admin/books", { preHandler: admin }, async (request, reply) => { service.saveBook(request.body as Parameters<DailyChapterService["saveBook"]>[0]); return reply.code(204).send(); });
    app.put("/daily-chapter/admin/questions", { preHandler: admin }, async (request, reply) => { service.saveQuestion(request.body as Parameters<DailyChapterService["saveQuestion"]>[0], request.user.id); return reply.code(204).send(); });
    app.put("/daily-chapter/admin/editions", { preHandler: admin }, async (request, reply) => { service.saveEdition(request.body as Parameters<DailyChapterService["saveEdition"]>[0]); return reply.code(204).send(); });
    app.post<{ Params: { id: string } }>("/daily-chapter/admin/editions/:id/publish", { preHandler: admin }, async (request, reply) => { service.publish(request.params.id); return reply.code(204).send(); });
    app.post("/daily-chapter/admin/import", { preHandler: admin, bodyLimit: 1_048_576 }, async (request, reply) => { service.importPack(request.body, request.user.id); return reply.code(204).send(); });
    app.post("/daily-chapter/admin/import-bank", { preHandler: admin, bodyLimit: 2_097_152 }, async (request, reply) => { service.importBank(request.body); return reply.code(204).send(); });
  };
}
