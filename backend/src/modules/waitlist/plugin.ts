import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { openWaitlistDb } from "./adapters/sqlite/connection.js";
import { createSqliteWaitlistRepository } from "./adapters/sqlite/sqliteWaitlistRepository.js";
import { confirmationSubject, confirmationText } from "./confirmation.js";
import { buildWaitlistRoutes } from "./routes.js";
import { createWaitlistService } from "./service.js";

type SendEmail = (to: string, subject: string, text: string) => Promise<void>;

export async function waitlistPlugin(app: FastifyInstance, options: { sendEmail?: SendEmail } = {}) {
  const db = openWaitlistDb();
  const repo = createSqliteWaitlistRepository(db);
  const { sendEmail } = options;
  if (!sendEmail) app.log.warn("[waitlist] email delivery is not configured — new signups get no confirmation email.");
  const service = createWaitlistService(
    repo,
    sendEmail &&
      ((email) => {
        sendEmail(email, confirmationSubject, confirmationText(email, env.FRONTEND_URL)).catch((error) =>
          app.log.error(error, "[waitlist] confirmation email failed")
        );
      })
  );

  await app.register(fastifyRateLimit, {
    max: 5,
    timeWindow: "1 minute"
  });

  await app.register(buildWaitlistRoutes(service));
}
