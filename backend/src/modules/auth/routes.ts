// HTTP layer for the auth module: request validation (zod) and mapping
// service-layer results/errors to responses. No business logic lives
// here — that's all in service.ts. Takes the already-composed AuthService
// as a plain argument (from plugin.ts, the composition root) rather than
// importing service.ts as a module — this file doesn't know or care
// which AuthRepository backs it.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AvatarDimensionsTooLargeError,
  AvatarError,
  AvatarTooLargeError,
  EmailInUseError,
  InvalidAvatarError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  OAuthAccountConflictError,
  UsernameInUseError
} from "./domain/errors.js";
import type { AuthService } from "./service.js";
import { MAX_AVATAR_UPLOAD_BYTES } from "./service.js";
import { authGuard } from "./guard.js";

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(30, "Username must be at most 30 characters.")
  .regex(/^[a-zA-Z0-9_.]+$/, "Username can only contain letters, numbers, underscores, and periods.");

const signupSchema = z.object({
  email: z.string().email(),
  username: usernameSchema,
  password: z.string().min(8, "Password must be at least 8 characters.")
});

const loginSchema = z.object({
  identifier: z.string().min(1, "Email or username is required."),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

const setUsernameSchema = z.object({
  username: usernameSchema
});

const avatarIdParamSchema = z.object({ id: z.string().uuid() });

function statusForAvatarError(err: AvatarError): number {
  if (err instanceof AvatarTooLargeError) return 413;
  if (err instanceof InvalidAvatarError || err instanceof AvatarDimensionsTooLargeError) return 422;
  return 400;
}

export function buildAuthRoutes(service: AuthService) {
  return async function authRoutes(app: FastifyInstance) {
    app.post("/auth/signup", async (request, reply) => {
      const parsed = signupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      try {
        const { user, tokens } = await service.signup(parsed.data.email, parsed.data.username, parsed.data.password);
        return reply.code(201).send({ user, ...tokens });
      } catch (err) {
        if (err instanceof EmailInUseError) return reply.code(409).send({ error: err.message });
        if (err instanceof UsernameInUseError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    });

    app.post("/auth/login", async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Email/username and password are required." });
      }
      try {
        const { user, tokens } = await service.login(parsed.data.identifier, parsed.data.password);
        return reply.send({ user, ...tokens });
      } catch (err) {
        if (err instanceof InvalidCredentialsError) return reply.code(401).send({ error: err.message });
        throw err;
      }
    });

    app.post("/auth/refresh", async (request, reply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "refreshToken is required." });
      }
      try {
        const tokens = await service.refresh(parsed.data.refreshToken);
        return reply.send(tokens);
      } catch (err) {
        if (err instanceof InvalidRefreshTokenError) return reply.code(401).send({ error: err.message });
        throw err;
      }
    });

    app.post("/auth/logout", async (request, reply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "refreshToken is required." });
      }
      service.logout(parsed.data.refreshToken);
      return reply.code(204).send();
    });

    // Requires a valid access token — logs out every session for that
    // user, not just the one presenting this request ("sign out
    // everywhere").
    app.post("/auth/logout-everywhere", { preHandler: authGuard }, async (request, reply) => {
      service.logoutEverywhere(request.user.id);
      return reply.code(204).send();
    });

    app.get("/auth/me", { preHandler: authGuard }, async (request, reply) => {
      // From the repository, not request.user: the guard's copy comes from
      // JWT claims and can lag a just-completed avatar change (see
      // domain/types.ts's AuthenticatedUser). request.user is the fallback
      // for a user deleted between token issue and this call.
      const user = service.getUserById(request.user.id) ?? request.user;
      return reply.send({ user });
    });

    // Claims a username for the signed-in account — the step a Google
    // sign-in without one yet is routed through on its first login.
    app.post("/auth/username", { preHandler: authGuard }, async (request, reply) => {
      const parsed = setUsernameSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid username." });
      }
      try {
        const user = await service.setUsername(request.user.id, parsed.data.username);
        return reply.send({ user });
      } catch (err) {
        if (err instanceof UsernameInUseError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    });

    app.post(
      "/auth/avatar",
      {
        preHandler: authGuard,
        // Aborts the upload stream over this size rather than buffering it
        // first — belt-and-suspenders alongside service.ts's own cap, same
        // as gallery's upload route.
        bodyLimit: MAX_AVATAR_UPLOAD_BYTES + 1024
      },
      async (request, reply) => {
        const upload = await request.file();
        if (!upload) {
          return reply.code(400).send({ error: "No file uploaded — send a multipart/form-data request with an \"image\" field." });
        }
        const buffer = await upload.toBuffer();
        try {
          const user = await service.setAvatar(request.user.id, buffer);
          return reply.send({ user });
        } catch (err) {
          if (err instanceof AvatarError) {
            return reply.code(statusForAvatarError(err)).send({ error: err.message });
          }
          throw err;
        }
      }
    );

    app.delete("/auth/avatar", { preHandler: authGuard }, async (request, reply) => {
      const user = await service.removeAvatar(request.user.id);
      return reply.send({ user });
    });

    // Deliberately NOT behind authGuard — a plain <img src> target, same
    // as gallery's file route. Access control is "the id is an
    // unguessable UUID"; the id regenerates on every replacement, so the
    // immutable caching below can't serve a stale avatar after a change.
    app.get("/auth/avatar/:id/file", async (request, reply) => {
      const parsed = avatarIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid avatar id." });
      }
      const file = service.getAvatarFile(parsed.data.id);
      if (!file) {
        return reply.code(404).send({ error: "No such avatar." });
      }
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.type(file.mimeType).send(file.buffer);
    });

    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof OAuthAccountConflictError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    });
  };
}
