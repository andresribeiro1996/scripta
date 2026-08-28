// HTTP layer for the socials module's plain CRUD-ish routes: list, mint a
// link session, connect Bluesky, disconnect. The four OAuth
// providers' own /connect + /callback routes are NOT here — each needs
// its own @fastify/oauth2 instance, registered directly in plugin.ts,
// the same place Google's OAuth routes live rather than in auth's
// routes.ts (see that file's own comment for why).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import { instagramOAuthConfigured, socialsEncryptionConfigured, threadsOAuthConfigured, tiktokOAuthConfigured, xOAuthConfigured } from "../../config/env.js";
import { BlueskyAuthError, SocialsNotConfiguredError } from "./domain/errors.js";
import { SOCIAL_PROVIDERS, type SocialProvider } from "./domain/types.js";
import { createLinkSession } from "./linkSessions.js";
import type { SocialsService } from "./service.js";

const OAUTH_PROVIDER_IDS: readonly string[] = ["x", "instagram", "threads", "tiktok"];

function isSocialProvider(value: string): value is SocialProvider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

const enabledByProvider: Record<SocialProvider, boolean> = {
  x: xOAuthConfigured,
  instagram: instagramOAuthConfigured,
  threads: threadsOAuthConfigured,
  tiktok: tiktokOAuthConfigured,
  // Bluesky needs no per-app developer credentials — just the storage
  // encryption key, same gate every provider's write path shares.
  bluesky: socialsEncryptionConfigured
};

const blueskyConnectSchema = z.object({
  handle: z.string().min(1, "Handle is required."),
  appPassword: z.string().min(1, "App password is required.")
});

export function buildSocialsRoutes(service: SocialsService) {
  return async function socialsRoutes(app: FastifyInstance) {
    app.get("/socials", { preHandler: authGuard }, async (request, reply) => {
      reply.send({ socials: service.listStatuses(request.user.id, enabledByProvider) });
    });

    app.post<{ Params: { provider: string } }>("/socials/:provider/link-session", { preHandler: authGuard }, async (request, reply) => {
      const { provider } = request.params;
      if (!OAUTH_PROVIDER_IDS.includes(provider)) {
        return reply.code(400).send({ error: `"${provider}" isn't an OAuth-based provider.` });
      }
      if (!enabledByProvider[provider as SocialProvider]) {
        return reply.code(503).send({ error: `${provider} is not configured on this server.` });
      }
      const linkId = createLinkSession(request.user.id, provider);
      reply.send({ linkId });
    });

    app.post("/socials/bluesky/connect", { preHandler: authGuard }, async (request, reply) => {
      const parsed = blueskyConnectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      try {
        await service.connectBluesky(request.user.id, parsed.data.handle, parsed.data.appPassword);
      } catch (err) {
        if (err instanceof BlueskyAuthError) return reply.code(401).send({ error: err.message });
        if (err instanceof SocialsNotConfiguredError) return reply.code(503).send({ error: err.message });
        throw err;
      }
      reply.send({ socials: service.listStatuses(request.user.id, enabledByProvider) });
    });

    app.delete<{ Params: { provider: string } }>("/socials/:provider", { preHandler: authGuard }, async (request, reply) => {
      const { provider } = request.params;
      if (!isSocialProvider(provider)) {
        return reply.code(400).send({ error: `Unknown provider "${provider}".` });
      }
      service.disconnect(request.user.id, provider);
      reply.send({ socials: service.listStatuses(request.user.id, enabledByProvider) });
    });
  };
}

export { enabledByProvider };
