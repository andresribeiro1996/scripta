// Ports: everything the gallery domain (service.ts) needs from the
// outside world. Two separate ports rather than one, deliberately — row
// metadata (searchable, small) and raw image bytes (large, write-once)
// are different enough storage problems that SQLite backing the former
// and the filesystem backing the latter (see adapters/sqlite/ and
// adapters/fs/) shouldn't have to pretend to be the same port. service.ts
// is written against both interfaces only, with no idea what's on the
// other side of either.

import type { GalleryImageRow } from "./types.js";

export interface GalleryRepository {
  listImages(userId: string): GalleryImageRow[];
  insertImage(row: GalleryImageRow): void;
  /** No ownership filter — needed by the public, unauthenticated
   *  GET /gallery/:id/file route (see routes.ts) to look up which
   *  account's blob to read, keyed only by the unguessable `id`. */
  getImageById(id: string): GalleryImageRow | undefined;
  /** Ownership-checked lookup — for anything that mutates or discloses
   *  more than the raw image bytes (currently just delete). */
  getOwnedImage(id: string, userId: string): GalleryImageRow | undefined;
  /** Returns true if a row was actually deleted (i.e. it existed AND was
   *  owned by userId) — service.ts uses this to know whether to also
   *  remove the blob and to report 404 vs success. */
  deleteImage(id: string, userId: string): boolean;
  /** Sum of byte_size across every image this user owns — the quota
   *  check in service.ts's uploadImage. */
  totalBytesForUser(userId: string): number;
}

export interface ImageBlobStore {
  save(userId: string, id: string, extension: string, bytes: Buffer): void;
  read(userId: string, id: string, extension: string): Buffer | null;
  delete(userId: string, id: string, extension: string): void;
}
