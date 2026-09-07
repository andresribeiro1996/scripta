// Mirrors frontend/src/api/library.ts's fetchLibrary/saveLibrary/
// shareLibrary/unshareLibrary, on top of this app's own apiClient
// (auth:true — refresh is handled inside, see core/apiClient.ts).
//
// saveLibrary is the CONDITIONAL-PUT half of Task 5A's critical item: it
// always sends the `updatedAt` of the document the caller is building on
// top of (see hooks/useLibrary.ts's updateLibrary, which reads it from
// the ["library"] query cache on every save — never a stale closure).
//
// *** REQUIRED BACKEND CHANGE — see this task's handoff notes ***
// backend/src/modules/library/routes.ts's PUT /library schema is
// currently `z.object({ data: ... })` with no `.strict()`/`.passthrough()`
// on the OUTER object, so an extra `updatedAt` field sent alongside
// `data` is silently stripped by zod, never validated, and the route
// still does a blind `service.saveLibrary(userId, data)` upsert with no
// comparison against the stored row's own `updated_at` at all — sending
// this field today changes nothing server-side. This client sends it
// anyway (harmless no-op today, forward-compatible the moment the route
// is fixed) and already handles the 409 this route doesn't yet return:
// on 409, re-fetch the document and let the caller re-apply its update
// against the fresh copy (see useLibrary.ts). Out of this task's
// ownership (backend/**) — the actual fix is one field: accept an
// optional top-level `updatedAt` in the PUT body, compare it against the
// stored document's own `updated_at` before writing, and return 409 (with
// the current document, so a client that wants to skip its own extra GET
// can use it directly) on a mismatch.
import { apiClient, ApiError } from "../../../core/api";
import type { LibraryData, LibraryDocument } from "./types";

/** Thrown by saveLibrary on a 409 — see this file's own top comment.
 *  Never thrown by today's backend (it doesn't send 409 yet), but the
 *  client is written against the contract Task 5A specifies rather than
 *  today's route, so it needs no further change once that route is
 *  fixed. */
export class LibraryConflictError extends Error {
  constructor() {
    super("The library changed elsewhere since this was loaded.");
  }
}

/** null means "no library saved yet" (backend 404s, not an error case
 *  here) — same convention as frontend's fetchLibrary. */
export async function fetchLibrary(): Promise<LibraryDocument | null> {
  try {
    return await apiClient.request<LibraryDocument>("/library", { auth: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** `expectedUpdatedAt` is the `updatedAt` of the document this `data` was
 *  built on top of — `undefined` only for the very first save, when
 *  there's nothing to be conditional against yet. See this file's own top
 *  comment for exactly what the backend does with it today (nothing) vs.
 *  what it's supposed to do once Task 5A's required route change lands. */
export async function saveLibrary(data: LibraryData, expectedUpdatedAt?: string): Promise<LibraryDocument> {
  try {
    return await apiClient.request<LibraryDocument>("/library", {
      method: "PUT",
      auth: true,
      body: expectedUpdatedAt === undefined ? { data } : { data, updatedAt: expectedUpdatedAt },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) throw new LibraryConflictError();
    throw err;
  }
}

export async function shareLibrary(): Promise<LibraryDocument> {
  return apiClient.request<LibraryDocument>("/library/share", { method: "POST", auth: true });
}

export async function unshareLibrary(): Promise<LibraryDocument> {
  return apiClient.request<LibraryDocument>("/library/unshare", { method: "POST", auth: true });
}
