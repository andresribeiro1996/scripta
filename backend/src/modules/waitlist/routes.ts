import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { localeOf, t } from "../../i18n/index.js";
import type { WaitlistService } from "./service.js";

const joinSchema = z.object({
  email: z.string().trim().max(254).email()
});

export function buildWaitlistRoutes(service: WaitlistService) {
  return async function waitlistRoutes(app: FastifyInstance) {
    app.post("/waitlist", async (request, reply) => {
      const locale = localeOf(request);
      const parsed = joinSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: t(locale, "waitlist.invalidEmail"), field: "email" });
      }
      service.join(parsed.data.email, locale);
      return reply.code(204).send();
    });
  };
}
