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
import { env } from "./config/env.js";
import { runStartupMigrations } from "./migrations/runStartupMigrations.js";
import { registerAuthModule } from "./modules/auth/index.js";
import { registerCoversModule } from "./modules/covers/index.js";
import { registerGalleryModule } from "./modules/gallery/index.js";
import { registerLibraryModule } from "./modules/library/index.js";
import { registerMuralsModule } from "./modules/murals/index.js";
import { registerSocialsModule } from "./modules/socials/index.js";

export function buildApp() {
  // Moves any still-embedded library.murals[] into the new murals table
  // before any module's routes come online — see
  // migrations/runStartupMigrations.ts for why this is safe to run on
  // every boot. Deliberately before Fastify/app.register: this only
  // touches the two modules' own SQLite files directly, nothing about
  // the app instance itself.
  runStartupMigrations();

  const app = Fastify({ logger: true });

  // Genuinely app-wide (unlike each module's own rate limiter) — the
  // frontend is a separate origin from this API in dev (Vite on 5173,
  // this on 3000) and will be in production too, so every module's
  // routes need it, not just one.
  app.register(fastifyCors, {
    origin: env.FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE"]
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.register(registerAuthModule);
  app.register(registerLibraryModule);
  app.register(registerGalleryModule);
  app.register(registerCoversModule);
  app.register(registerSocialsModule);
  app.register(registerMuralsModule);

  return app;
}
