import { FINISH_FEELINGS, gameOwnerLabel, readerCountsLabel, readerStatusLabel, summaryPreview, type WorkGameRef, type WorkPage, type WorkReader } from "@scripta/shared";

const readerRow = (reader: WorkReader) => ({ username: reader.username, avatarUrl: reader.avatarUrl, readerGlyph: reader.readerGlyph, status: readerStatusLabel(reader.readStatus), linksToProfile: reader.published });

export function workScreenSections(page: WorkPage) {
  const { mine, readers, games } = page;
  const feeling = mine?.rating ? FINISH_FEELINGS.find((f) => f.rating === mine.rating)?.label ?? null : null;
  const kinds: Array<[string, string, WorkGameRef[]]> = [["tierlist", "Tier list", games.tierlists], ["arena", "Tournament", games.arenas], ["quiz", "Quiz", games.quizzes]];
  const gameRows = kinds.flatMap(([key, label, list]) => list.map((game) => ({ key: `${key}-${game.id}`, title: game.name, detail: `${label} · ${gameOwnerLabel(game.owner)}`, path: game.path })));
  return {
    about: page.work.summary,
    aboutPreview: page.work.summary ? summaryPreview(page.work.summary) : null,
    mine: mine ? { status: readerStatusLabel(mine.readStatus), detail: [feeling, `${mine.highlightCount} ${mine.highlightCount === 1 ? "highlight" : "highlights"}`].filter(Boolean).join(" · ") } : null,
    countsLabel: readerCountsLabel(readers.counts),
    readerGroups: [
      { title: "People you follow", rows: readers.followed.map(readerRow) },
      { title: "Other readers", rows: readers.others.map(readerRow) }
    ].filter((group) => group.rows.length > 0),
    games: gameRows,
    gamesEmpty: gameRows.length === 0
  };
}

export function workPath(id: string, segments: readonly string[]): string {
  return segments[0] === "(app)" ? `/work/${id}` : `/(public)/work/${id}`;
}
