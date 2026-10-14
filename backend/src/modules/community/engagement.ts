import { randomUUID } from "node:crypto";
import type { ActivityComment, CommunityAuthor, Page, SavedContentRef } from "@scripta/shared/community";
import { decodeCursor, encodeCursor } from "@scripta/shared/community";
import type { DigestItem } from "@scripta/shared/dashboard";
import type { ReaderProfile } from "@scripta/shared";
import type { EngagementRepository } from "./domain/ports.js";
import { InvalidCursorError, ProfileNotFoundError, UsernameRequiredError } from "./domain/errors.js";
import type { CommunityService } from "./service.js";

export function createEngagementService({ repo, community, resolveProfiles, now = Date.now }: { repo: EngagementRepository; community: Pick<CommunityService, "resolveEvent" | "visibleEventIds" | "resolveSavedContent">; resolveProfiles: (ids: string[]) => Map<string, ReaderProfile>; now?: () => number }) {
  function requireEvent(viewerId: string, id: string) {
    const event = repo.getEvent(id);
    if (!event) throw new ProfileNotFoundError();
    community.resolveEvent(viewerId, event);
  }
  function keyset(cursor?: string) {
    const value = cursor ? decodeCursor(cursor) : undefined;
    if (cursor && !value) throw new InvalidCursorError();
    return value;
  }
  return {
    getSavedState: (viewerId: string, refs: SavedContentRef[]) => repo.savedState(viewerId, refs),
    getEngagement(viewerId: string, ids: string[]) {
      return repo.summaries(viewerId, [...community.visibleEventIds(viewerId, repo.getEvents(ids))]);
    },
    setLiked(viewerId: string, id: string, liked: boolean) {
      requireEvent(viewerId, id);
      repo.setLiked(viewerId, id, liked, new Date(now()).toISOString());
      return repo.summaries(viewerId, [id])[id]!;
    },
    getComments(viewerId: string, id: string, cursor: string | undefined, limit: number): Page<ActivityComment> {
      requireEvent(viewerId, id);
      const rows = repo.listComments(id, keyset(cursor), limit + 1);
      const shown = rows.slice(0, limit);
      const profiles = resolveProfiles(shown.map((row) => row.user_id));
      const last = shown.at(-1);
      return { items: shown.flatMap((row) => {
        const author = profiles.get(row.user_id);
        return author ? [{ id: row.id, author: { ...author, userId: row.user_id } satisfies CommunityAuthor, text: row.text, createdAt: row.created_at, own: row.user_id === viewerId }] : [];
      }), nextCursor: rows.length > limit && last ? encodeCursor({ id: last.id, createdAt: last.created_at }) : null };
    },
    addComment(viewerId: string, id: string, text: string) {
      requireEvent(viewerId, id);
      if (!resolveProfiles([viewerId]).has(viewerId)) throw new UsernameRequiredError();
      repo.insertComment({ id: randomUUID(), event_id: id, user_id: viewerId, text, created_at: new Date(now()).toISOString() });
    },
    deleteComment(viewerId: string, id: string) {
      const comment = repo.getComment(id);
      if (!comment || comment.user_id !== viewerId) throw new ProfileNotFoundError();
      if (!repo.deleteComment(id, viewerId)) throw new ProfileNotFoundError();
    },
    setSaved(viewerId: string, ref: SavedContentRef, saved: boolean) {
      if (saved) community.resolveSavedContent(viewerId, ref, new Date(now()).toISOString());
      repo.setSaved(viewerId, ref, saved, new Date(now()).toISOString());
    },
    getSaved(viewerId: string, cursor: string | undefined, limit: number): Page<DigestItem> {
      const rows = repo.listSaved(viewerId, keyset(cursor), limit + 1);
      const shown = rows.slice(0, limit);
      const items = shown.flatMap((row) => {
        const ref: SavedContentRef = row.kind === "mural" ? { kind: "mural", id: row.ref_id, ownerId: row.owner_id ?? "" } : { kind: row.kind, id: row.ref_id };
        try { return [community.resolveSavedContent(viewerId, ref, row.saved_at)]; }
        catch (error) { if (error instanceof ProfileNotFoundError) return []; throw error; }
      });
      const last = shown.at(-1);
      return { items, nextCursor: rows.length > limit && last ? encodeCursor({ id: `${last.kind}:${last.ref_id}`, createdAt: last.saved_at }) : null };
    }
  };
}

export type EngagementService = ReturnType<typeof createEngagementService>;
