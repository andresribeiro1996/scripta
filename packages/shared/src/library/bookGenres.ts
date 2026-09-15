export const BOOK_GENRES = [
  "Fantasy",
  "Science Fiction",
  "Romance",
  "Mystery",
  "Thriller",
  "Horror",
  "Crime",
  "Historical Fiction",
  "Literary Fiction",
  "Classics",
  "Biography & Memoir",
  "History",
  "Politics",
  "Philosophy",
  "Psychology",
  "Science",
  "Technology",
  "Business",
  "Self-Help",
  "Poetry",
  "Religion",
  "Travel",
  "Cooking",
  "Young Adult",
  "Children's",
  "Comics & Graphic Novels"
] as const;

export type BookGenre = (typeof BOOK_GENRES)[number];

const RULES: Array<[BookGenre, RegExp]> = [
  ["Science Fiction", /\b(?:science fiction|sci fi|scifi)\b/],
  ["Historical Fiction", /\bhistorical fiction\b/],
  ["Literary Fiction", /\bliterary fiction\b/],
  ["Classics", /\bclassics?\b|\bclassic literature\b/],
  ["Biography & Memoir", /\b(?:biograph\w*|autobiograph\w*|memoirs?)\b/],
  ["Comics & Graphic Novels", /\b(?:comics?|graphic novels?|manga)\b/],
  ["Young Adult", /\b(?:young adult|ya fiction)\b/],
  ["Children's", /\b(?:children s|childrens|juvenile fiction|picture books?)\b/],
  ["Fantasy", /\bfantasy\b/],
  ["Romance", /\bromance\b/],
  ["Mystery", /\bmyst(?:ery|eries)\b|\bdetective fiction\b/],
  ["Thriller", /\bthrillers?\b|\bsuspense\b/],
  ["Horror", /\bhorror\b/],
  ["Crime", /\bcrime(?: fiction)?\b/],
  ["History", /\bhistory\b|\bhistorical studies\b/],
  ["Politics", /\bpolitic\w*\b|\bgovernment\b/],
  ["Philosophy", /\bphilosoph\w*\b/],
  ["Psychology", /\bpsycholog\w*\b/],
  ["Technology", /\b(?:technology|computers?|programming|software)\b/],
  ["Science", /\bscience\b|\b(?:physics|chemistry|biology|astronomy)\b/],
  ["Business", /\b(?:business|economics|finance|entrepreneurship|management)\b/],
  ["Self-Help", /\bself help\b|\bpersonal development\b/],
  ["Poetry", /\bpoetry\b|\bpoems?\b/],
  ["Religion", /\b(?:religion|theology|spirituality)\b/],
  ["Travel", /\btravel\b/],
  ["Cooking", /\b(?:cooking|cookbooks?|food)\b/]
];

function valuesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? value.split(/[,;|]/) : [];
}

export function normalizeBookGenres(value: unknown): BookGenre[] {
  const found = new Set<BookGenre>();
  for (const raw of valuesOf(value)) {
    const subject = raw.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const match = RULES.find(([, pattern]) => pattern.test(subject));
    if (match) found.add(match[0]);
  }
  return BOOK_GENRES.filter((genre) => found.has(genre));
}

export function genresForBook(book: Record<string, unknown>): BookGenre[] {
  return normalizeBookGenres(book._genres);
}

export function needsGenreMetadata(book: Record<string, unknown>): boolean {
  return !Object.prototype.hasOwnProperty.call(book, "_genres");
}

export interface ShelfTheme {
  genres: BookGenre[];
  matchedBooks: number;
  totalBooks: number;
}

export function calculateShelfTheme(books: Array<Record<string, unknown>>, limit = 3): ShelfTheme {
  const counts = new Map<BookGenre, number>();
  let matchedBooks = 0;
  for (const book of books) {
    const genres = genresForBook(book);
    if (genres.length) matchedBooks++;
    for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  const order = new Map<BookGenre, number>(BOOK_GENRES.map((genre, index) => [genre, index]));
  const genres = [...counts].sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)).slice(0, Math.max(0, limit)).map(([genre]) => genre);
  return { genres, matchedBooks, totalBooks: books.length };
}
