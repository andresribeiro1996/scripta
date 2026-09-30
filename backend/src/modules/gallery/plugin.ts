// The gallery module's Fastify plugin and composition root — mirrors
// modules/library/plugin.ts's shape, plus modules/auth/plugin.ts's
// pattern of registering a plugin-scoped concern (there: rate-limit;
// here: rate-limit AND multipart) that only this module's routes need.

import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { createObjectStore } from "../../storage/createObjectStore.js";
import { createSqliteGalleryRepository } from "./adapters/sqlite/sqliteGalleryRepository.js";
import { openGalleryDb } from "./adapters/sqlite/connection.js";
import { buildGalleryRoutes } from "./routes.js";
import { createGalleryService, deleteAllGalleryImages, MAX_UPLOAD_BYTES } from "./service.js";
import type { ImageBlobStore } from "./domain/ports.js";

const keyFor = (id: string) => `gallery/${id}.webp`;
const galleryUrlFor = (id: string) => createObjectStore().urlFor(keyFor(id));

function imageBlobStore(): ImageBlobStore {
  return {
    save: (id, bytes) => createObjectStore().put(keyFor(id), bytes, "image/webp"),
    delete: (id) => createObjectStore().delete(keyFor(id))
  };
}

export async function galleryPlugin(app: FastifyInstance) {
  // --- composition: swap either block to change storage technology ---
  const db = openGalleryDb();
  const galleryRepository = createSqliteGalleryRepository(db);
  const blobStore = imageBlobStore();
  const publicUrlFor = galleryUrlFor;
  const galleryService = createGalleryService(galleryRepository, blobStore, publicUrlFor);
  // -----------------------------------------------------------------------

  // Scoped to this plugin only, same reasoning as auth's own rate-limit
  // registration — a background auto-decode-and-resize pipeline is worth
  // protecting from being hammered even by a well-meaning buggy client;
  // other modules set their own limits independently, if any.
  await app.register(fastifyRateLimit, {
    max: 30,
    timeWindow: "1 minute"
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1
    }
  });

  await app.register(buildGalleryRoutes(galleryService, publicUrlFor));
}

let erasingGallery: ReturnType<typeof createSqliteGalleryRepository> | undefined;

export async function deleteGalleryUserData(userId: string): Promise<void> {
  erasingGallery ??= createSqliteGalleryRepository(openGalleryDb());
  await deleteAllGalleryImages(erasingGallery, imageBlobStore(), userId);
}
