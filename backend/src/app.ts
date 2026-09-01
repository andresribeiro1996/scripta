// Composes the Fastify app from independent modules. This file is the
// ONLY place that imports a module's public index.ts purely to REGISTER
// it into the app. Modules may also import each other's public index.ts
// directly when they genuinely depend on one another — e.g.
// modules/library/routes.ts imports `authGuard` from modules/auth/index.js,
// since a library document belongs to a signed-in user. What's off-limits
// either way is reaching past a module's index.ts into its internals
// (domain/, adapters/, service.ts) — that's the actual boundary, not "no
// imports between modules at all."

import fastifyCors from "@fastify/cors";
import Fastify from "fastify";
import { env, trustProxy, usePostgres } from "./config/env.js";
import { closePool } from "./shared/postgres/pool.js";
import { registerAuthModule } from "./modules/auth/index.js";
import { registerCoversModule } from "./modules/covers/index.js";
import { registerGalleryModule } from "./modules/gallery/index.js";
import { registerLibraryModule } from "./modules/library/index.js";
import { registerSocialsModule } from "./modules/socials/index.js";

export function buildApp() {
  // trustProxy decides what `request.ip` means, which is what every
  // module's rate limiter keys on — see config/env.ts's TRUST_PROXY for
  // why it is configured per deployment rather than hardcoded either way.
  const app = Fastify({ logger: true, trustProxy });

  // Genuinely app-wide (unlike each module's own rate limiter) — the
  // frontend is a separate origin from this API in dev (Vite on 5173,
  // this on 3000) and will be in production too, so every module's
  // routes need it, not just one.
  app.register(fastifyCors, {
    origin: env.FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE"]
  });

  app.get("/health", async () => ({ status: "ok" }));

  // One pool serves every Postgres-backed module (see
  // shared/postgres/pool.ts), so it is closed once here rather than by
  // each module. Without this a rolling deploy leaves connections held
  // until the provider times them out, and a small managed Postgres has
  // few to spare.
  if (usePostgres) {
    app.addHook("onClose", async () => {
      await closePool();
    });
  }

  app.register(registerAuthModule);
  app.register(registerLibraryModule);
  app.register(registerGalleryModule);
  app.register(registerCoversModule);
  app.register(registerSocialsModule);

  return app;
}
