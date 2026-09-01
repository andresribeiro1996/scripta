// HTTP layer for the gallery module: request validation and mapping
// service results to responses. No business logic here — see service.ts.
//
// Cross-module dependency in action, same as modules/library/routes.ts:
// authGuard comes from auth's PUBLIC interface only.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import { FileTooLargeError, GalleryError, ImageDimensionsTooLargeError, InvalidImageError, QuotaExceededError } from "./domain/errors.js";
import { MAX_UPLOAD_BYTES } from "./service.js";
import type { GalleryService } from "./service.js";

function statusForGalleryError(err: GalleryError): number {
  // 413 Payload Too Large: file itself, or the account's storage quota,
  // was the problem. 422 Unprocessable Entity: the bytes came through
  // fine size-wise but aren't a valid/acceptable image.
  if (err instanceof FileTooLargeError || err instanceof QuotaExceededError) return 413;
  if (err instanceof InvalidImageError || err instanceof ImageDimensionsTooLargeError) return 422;
  return 400;
}

const idParamSchema = z.object({ id: z.string().uuid() });

export function buildGalleryRoutes(service: GalleryService) {
  return async function galleryRoutes(app: FastifyInstance) {
    app.get("/gallery", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ images: await service.listImages(request.user.id) });
    });

    app.post(
      "/gallery",
      {
        preHandler: authGuard,
        // Belt-and-suspenders alongside service.ts's own MAX_UPLOAD_BYTES
        // check: @fastify/multipart aborts the upload stream itself once
        // it goes over this, rather than buffering an oversized file into
        // memory first just to reject it after the fact.
        bodyLimit: MAX_UPLOAD_BYTES + 1024
      },
      async (request, reply) => {
        const upload = await request.file();
        if (!upload) {
          return reply.code(400).send({ error: "No file uploaded — send a multipart/form-data request with an \"image\" field." });
        }
        const buffer = await upload.toBuffer();
        try {
          const image = await service.uploadImage(request.user.id, buffer, upload.filename);
          return reply.code(201).send({ image });
        } catch (err) {
          if (err instanceof GalleryError) {
            return reply.code(statusForGalleryError(err)).send({ error: err.message });
          }
          throw err;
        }
      }
    );

    app.delete("/gallery/:id", { preHandler: authGuard }, async (request, reply) => {
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid image id." });
      }
      const deleted = await service.deleteImage(request.user.id, parsed.data.id);
      if (!deleted) {
        return reply.code(404).send({ error: "No image with that id in your gallery." });
      }
      return reply.code(204).send();
    });

    // Deliberately NOT behind authGuard — see domain/types.ts's
    // GalleryImage.url comment for why this needs to work as a plain
    // <img src>. Access control here is "the id is an unguessable UUID",
    // same trust model this app already applies to Kobo/Open Library
    // cover URLs, not a session check.
    app.get("/gallery/:id/file", async (request, reply) => {
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid image id." });
      }
      const file = await service.getImageFile(parsed.data.id);
      if (!file) {
        return reply.code(404).send({ error: "No such image." });
      }
      // Re-encoded output never changes once uploaded (there's no "edit"
      // operation — only upload/delete), so this is safe to cache
      // aggressively; a deleted image's id simply 404s from then on.
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.type(file.mimeType).send(file.buffer);
    });
  };
}
