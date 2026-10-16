const CAP = 3;

export type WorkGenres = { genres: string[]; possibleGenres: string[] };

export function workGenres(editions: Array<{ genres: readonly string[]; possible?: boolean }>): WorkGenres {
  const counts = new Map<string, { editions: number; possible: number }>();
  for (const edition of editions) {
    for (const genre of edition.genres) {
      const count = counts.get(genre) ?? { editions: 0, possible: 0 };
      count.editions += 1;
      if (edition.possible) count.possible += 1;
      counts.set(genre, count);
    }
  }
  const ranked = [...counts].sort((a, b) => b[1].editions - a[1].editions);
  const genres = ranked.filter(([, count]) => count.possible < count.editions).map(([genre]) => genre).slice(0, CAP);
  const possibleGenres = ranked.filter(([, count]) => count.possible === count.editions).map(([genre]) => genre).slice(0, CAP - genres.length);
  return { genres, possibleGenres };
}
