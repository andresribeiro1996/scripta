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
  listImages(userId: string): Promise<GalleryImageRow[]>;
  insertImage(row: GalleryImageRow): Promise<void>;
  /** No ownership filter — needed by the public, unauthenticated
   *  GET /gallery/:id/file route (see routes.ts) to look up which
   *  account's blob to read, keyed only by the unguessable `id`. */
  getImageById(id: string): Promise<GalleryImageRow | undefined>;
  /** Ownership-checked lookup — for anything that mutates or discloses
   *  more than the raw image bytes (currently just delete). */
  getOwnedImage(id: string, userId: string): Promise<GalleryImageRow | undefined>;
  /** Returns true if a row was actually deleted (i.e. it existed AND was
   *  owned by userId) — service.ts uses this to know whether to also
   *  remove the blob and to report 404 vs success. */
  deleteImage(id: string, userId: string): Promise<boolean>;
  /** Sum of byte_size across every image this user owns — the quota
   *  check in service.ts's uploadImage. */
  totalBytesForUser(userId: string): Promise<number>;
}

// Async for the same reason modules/library's own repository port is:
// object storage (see adapters/s3/) is a network call and cannot answer
// synchronously. The filesystem adapter resolves immediately. Keeping the
// port synchronous would have made moving blobs off local disk a rewrite
// of service.ts rather than a new adapter — and blobs on local disk are
// what pin this API to a single machine.
export interface ImageBlobStore {
  save(userId: string, id: string, extension: string, bytes: Buffer): Promise<void>;
  read(userId: string, id: string, extension: string): Promise<Buffer | null>;
  delete(userId: string, id: string, extension: string): Promise<void>;
}
