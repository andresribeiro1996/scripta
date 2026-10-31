import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";

export const DAILY_CHAPTER_THEMES = [
  {
    "id": "cozy-mysteries",
    "name": "Cozy mysteries",
    "family": "Genres",
    "motif": "window",
    "tone": "sage"
  },
  {
    "id": "space-adventures",
    "name": "Space adventures",
    "family": "Genres",
    "motif": "planet",
    "tone": "blue"
  },
  {
    "id": "romantic-comedies",
    "name": "Romantic comedies",
    "family": "Genres",
    "motif": "heart",
    "tone": "rose"
  },
  {
    "id": "gothic-stories",
    "name": "Gothic stories",
    "family": "Genres",
    "motif": "window",
    "tone": "plum"
  },
  {
    "id": "historical-fiction",
    "name": "Historical fiction",
    "family": "Genres",
    "motif": "column",
    "tone": "ochre"
  },
  {
    "id": "bookshops-libraries",
    "name": "Bookshops & libraries",
    "family": "Places",
    "motif": "books",
    "tone": "sage"
  },
  {
    "id": "island-stories",
    "name": "Island stories",
    "family": "Places",
    "motif": "island",
    "tone": "blue"
  },
  {
    "id": "boarding-schools",
    "name": "Boarding schools",
    "family": "Places",
    "motif": "window",
    "tone": "copper"
  },
  {
    "id": "train-journeys",
    "name": "Train journeys",
    "family": "Places",
    "motif": "train",
    "tone": "blue"
  },
  {
    "id": "small-towns",
    "name": "Small towns",
    "family": "Places",
    "motif": "houses",
    "tone": "sage"
  },
  {
    "id": "found-family",
    "name": "Found family",
    "family": "Relationships",
    "motif": "people",
    "tone": "rose"
  },
  {
    "id": "unlikely-friendships",
    "name": "Unlikely friendships",
    "family": "Relationships",
    "motif": "people",
    "tone": "sage"
  },
  {
    "id": "complicated-siblings",
    "name": "Complicated siblings",
    "family": "Relationships",
    "motif": "people",
    "tone": "plum"
  },
  {
    "id": "rivals-romance",
    "name": "Rivals & romance",
    "family": "Relationships",
    "motif": "heart",
    "tone": "rose"
  },
  {
    "id": "across-generations",
    "name": "Across generations",
    "family": "Relationships",
    "motif": "portrait",
    "tone": "ochre"
  },
  {
    "id": "time-travel",
    "name": "Time travel",
    "family": "Story premises",
    "motif": "clock",
    "tone": "blue"
  },
  {
    "id": "secret-identities",
    "name": "Secret identities",
    "family": "Story premises",
    "motif": "key",
    "tone": "copper"
  },
  {
    "id": "disappearances",
    "name": "Disappearances",
    "family": "Story premises",
    "motif": "window",
    "tone": "plum"
  },
  {
    "id": "strange-invitations",
    "name": "Strange invitations",
    "family": "Story premises",
    "motif": "envelope",
    "tone": "rose"
  },
  {
    "id": "impossible-places",
    "name": "Impossible places",
    "family": "Story premises",
    "motif": "door",
    "tone": "sage"
  },
  {
    "id": "opening-lines",
    "name": "Opening lines",
    "family": "Storytelling",
    "motif": "pen",
    "tone": "copper"
  },
  {
    "id": "letters-diaries",
    "name": "Letters & diaries",
    "family": "Storytelling",
    "motif": "envelope",
    "tone": "copper"
  },
  {
    "id": "stories-within-stories",
    "name": "Stories within stories",
    "family": "Storytelling",
    "motif": "books",
    "tone": "plum"
  },
  {
    "id": "unreliable-narrators",
    "name": "Unreliable narrators",
    "family": "Storytelling",
    "motif": "mirror",
    "tone": "ink"
  },
  {
    "id": "one-extraordinary-day",
    "name": "One extraordinary day",
    "family": "Storytelling",
    "motif": "sun",
    "tone": "ochre"
  },
  {
    "id": "page-to-screen",
    "name": "Page to screen",
    "family": "Book culture",
    "motif": "film",
    "tone": "copper"
  },
  {
    "id": "retold-myths",
    "name": "Retold myths",
    "family": "Book culture",
    "motif": "column",
    "tone": "ochre"
  },
  {
    "id": "pen-names",
    "name": "Pen names",
    "family": "Book culture",
    "motif": "pen",
    "tone": "ink"
  },
  {
    "id": "debut-novels",
    "name": "Debut novels",
    "family": "Book culture",
    "motif": "books",
    "tone": "rose"
  },
  {
    "id": "books-about-books",
    "name": "Books about books",
    "family": "Book culture",
    "motif": "books",
    "tone": "sage"
  },
  {
    "id": "japanese-fiction",
    "name": "Japanese fiction",
    "family": "Around the world",
    "motif": "window",
    "tone": "blue"
  },
  {
    "id": "portuguese-literature",
    "name": "Portuguese literature",
    "family": "Around the world",
    "motif": "tiles",
    "tone": "blue"
  },
  {
    "id": "latin-american-voices",
    "name": "Latin American voices",
    "family": "Around the world",
    "motif": "sun",
    "tone": "rose"
  },
  {
    "id": "african-storytelling",
    "name": "African storytelling",
    "family": "Around the world",
    "motif": "tree",
    "tone": "ochre"
  },
  {
    "id": "translated-favourites",
    "name": "Translated favourites",
    "family": "Around the world",
    "motif": "books",
    "tone": "copper"
  },
  {
    "id": "memoirs",
    "name": "Memoirs",
    "family": "True stories",
    "motif": "portrait",
    "tone": "copper"
  },
  {
    "id": "natural-world",
    "name": "The natural world",
    "family": "True stories",
    "motif": "leaf",
    "tone": "sage"
  },
  {
    "id": "scientific-discoveries",
    "name": "Scientific discoveries",
    "family": "True stories",
    "motif": "planet",
    "tone": "blue"
  },
  {
    "id": "remarkable-journeys",
    "name": "Remarkable journeys",
    "family": "True stories",
    "motif": "compass",
    "tone": "ochre"
  },
  {
    "id": "hidden-histories",
    "name": "Hidden histories",
    "family": "True stories",
    "motif": "column",
    "tone": "plum"
  }
] as const;

export type DailyChapterTheme = (typeof DAILY_CHAPTER_THEMES)[number];

export function dailyThemeName(id: string, locale: Locale): string {
  const theme = DAILY_CHAPTER_THEMES.find((item) => item.id === id);
  return theme ? sharedT(locale)(`shared.dailyThemes.${theme.id}`) : id;
}
