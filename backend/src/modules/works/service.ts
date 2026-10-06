import { plainDescription, type IdentityKey, type ReaderProfile, type WorkGameRef, type WorkPage, type WorkReader } from "@scripta/shared";
import type { CatalogWorkPage } from "../books/index.js";
import type { ViewerCopy } from "../library/index.js";

type GameByWork = { id: string; name: string; path: string; ownerUserId: string | null };
type Visibility = { followed: boolean; published: boolean; showGlyph: boolean };

export type WorksDeps = {
  getWorkPage(id: string): CatalogWorkPage | undefined;
  holdersOfWorks(workIds: string[]): Array<{ userId: string; readStatus: 0 | 1 | 2 }>;
  copyOfWork(userId: string, workIds: string[]): ViewerCopy | undefined;
  readerVisibility(viewerId: string | null, userIds: string[]): Map<string, Visibility>;
  resolveProfiles(userIds: string[]): Map<string, ReaderProfile>;
  readerGlyphFor(userId: string): IdentityKey | null;
  tierlists(workIds: string[], limit: number): GameByWork[];
  arenas(workIds: string[], limit: number): GameByWork[];
  quizzes(workIds: string[], limit: number): GameByWork[];
};

const READER_CAP = 50;
const GAME_CAP = 20;
const isbnKey = (isbn: string | null) => (isbn ? isbn.replace(/[\s-]/g, "") : null);
const byUsername = (a: WorkReader, b: WorkReader) => a.username.toLowerCase().localeCompare(b.username.toLowerCase());

export function createWorksService(deps: WorksDeps) {
  function games(workIds: string[]) {
    const lists = { tierlists: deps.tierlists(workIds, GAME_CAP), arenas: deps.arenas(workIds, GAME_CAP), quizzes: deps.quizzes(workIds, GAME_CAP) };
    const owners = deps.resolveProfiles([...new Set(Object.values(lists).flat().flatMap((game) => (game.ownerUserId ? [game.ownerUserId] : [])))]);
    const refs = (items: GameByWork[]): WorkGameRef[] => items.flatMap((game) => {
      const owner = game.ownerUserId === null ? "app" as const : owners.get(game.ownerUserId);
      return owner ? [{ id: game.id, name: game.name, owner, path: game.path }] : [];
    });
    return { tierlists: refs(lists.tierlists), arenas: refs(lists.arenas), quizzes: refs(lists.quizzes) };
  }

  function readers(workIds: string[], viewerId: string | null): WorkPage["readers"] {
    const holders = deps.holdersOfWorks(workIds).filter((holder) => holder.userId !== viewerId);
    const visible = deps.readerVisibility(viewerId, holders.map((holder) => holder.userId));
    const profiles = deps.resolveProfiles([...visible.keys()]);
    const followed: WorkReader[] = [];
    const others: WorkReader[] = [];
    for (const holder of holders) {
      const seen = visible.get(holder.userId);
      const profile = profiles.get(holder.userId);
      if (!seen || !profile) continue;
      const glyph = seen.showGlyph ? deps.readerGlyphFor(holder.userId) : null;
      const reader: WorkReader = { ...profile, ...(glyph ? { readerGlyph: glyph } : {}), readStatus: holder.readStatus, published: seen.published };
      (seen.followed ? followed : others).push(reader);
    }
    followed.sort(byUsername);
    others.sort(byUsername);
    const all = [...followed, ...others];
    const shownFollowed = followed.slice(0, READER_CAP);
    return {
      followed: shownFollowed,
      others: others.slice(0, READER_CAP - shownFollowed.length),
      counts: { readers: all.length, finished: all.filter((reader) => reader.readStatus === 2).length }
    };
  }

  return {
    getPage(id: string, viewerId: string | null): WorkPage | undefined {
      const work = deps.getWorkPage(id);
      if (!work) return undefined;
      const copy = viewerId ? deps.copyOfWork(viewerId, work.aliasIds) : undefined;
      const mineIsbn = isbnKey(copy?.isbn ?? null);
      const mineEdition = mineIsbn ? work.editions.find((edition) => isbnKey(edition.isbn) === mineIsbn) : undefined;
      const summary = mineEdition?.summary ?? work.summary ?? work.editions.find((edition) => edition.summary)?.summary ?? null;
      const coverUrl = copy?.coverUrl ?? mineEdition?.coverUrl ?? work.editions.find((edition) => edition.coverUrl)?.coverUrl ?? null;
      return {
        work: {
          id: work.id,
          title: work.title,
          author: work.author,
          summary: summary && plainDescription(summary),
          coverUrl,
          editions: work.editions.map((edition) => ({ bookId: edition.bookId, title: edition.title, language: edition.language, year: edition.year, isbn: edition.isbn, mine: edition === mineEdition }))
        },
        mine: copy ? { bookKey: copy.bookKey, readStatus: copy.readStatus, rating: copy.rating, highlightCount: copy.highlightCount } : null,
        readers: readers(work.aliasIds, viewerId),
        games: games(work.aliasIds)
      };
    }
  };
}

export type WorksService = ReturnType<typeof createWorksService>;
