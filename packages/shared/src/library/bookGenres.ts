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
  ["Historical Fiction", /\bromances? historicos?\b/],
  ["Mystery", /\bromances? policia(?:l|is)\b/],
  ["Science Fiction", /\b(?:science fiction|sci fi|scifi|ficcao cientifica)\b/],
  ["Historical Fiction", /\bhistorical fiction\b|\bfiction historical\b|\bficcao historica\b/],
  ["Literary Fiction", /\bliterary fiction\b|\bfiction literary\b|\bficcao literaria\b/],
  ["Classics", /\bclassics?\b|\bclassic literature\b|\bclassicos?\b/],
  ["Biography & Memoir", /\b(?:biograph\w*|autobiograph\w*|memoirs?|biografias?|autobiografias?|memorias)\b/],
  ["Comics & Graphic Novels", /\b(?:comics?|graphic novels?|manga|banda desenhada|quadrinhos)\b/],
  ["Children's", /\binfanto ?juvenil\b/],
  ["Young Adult", /\b(?:young adult|ya fiction|juvenil|jovens adultos)\b/],
  ["Children's", /\b(?:children s|childrens|juvenile fiction|picture books?|infantil|infantis)\b/],
  ["Fantasy", /\b(?:fantasy|fantasia)\b/],
  ["Romance", /\bromance\b|\bliteratura romantica\b/],
  ["Mystery", /\bmyst(?:ery|eries)\b|\bdetective fiction\b|\bpolicia(?:l|is)\b|\bmisterios?\b/],
  ["Thriller", /\bthrillers?\b|\bsuspenses?\b/],
  ["Horror", /\b(?:horror|terror)\b/],
  ["Crime", /\bcrimes?(?: fiction)?\b/],
  ["History", /\bhistory\b|\bhistorical studies\b|\bhistoria\b/],
  ["Politics", /\bpolitic\w*\b|\bgovernment\b/],
  ["Philosophy", /\b(?:philosoph\w*|filosofi\w*)\b/],
  ["Psychology", /\b(?:psycholog\w*|psicologi\w*)\b/],
  ["Technology", /\b(?:technology|computers?|programming|software|tecnologi\w*|informatica)\b/],
  ["Science", /\bscience\b|\b(?:physics|chemistry|biology|astronomy|ciencias?|fisica|quimica|biologia|astronomia)\b/],
  ["Business", /\b(?:business|economics|finance|entrepreneurship|management|economia|gestao|financas|negocios|empreendedorismo)\b/],
  ["Self-Help", /\bself help\b|\bpersonal development\b|\bauto ?ajuda\b|\bdesenvolvimento pessoal\b/],
  ["Poetry", /\bpoetry\b|\bpoems?\b|\bpoesia\b|\bpoemas?\b/],
  ["Religion", /\b(?:religion|theology|spirituality|religiao|teologia|espiritualidade)\b/],
  ["Travel", /\b(?:travel|viage(?:m|ns))\b/],
  ["Cooking", /\b(?:cooking|cookbooks?|food|culinaria|receitas|gastronomia)\b/]
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

export function isFinishedBook(book: Record<string, unknown>): boolean {
  return book.ReadStatus === 2;
}

export const GENRE_LOOKUP_BATCH = 20;
export const GENRE_LOOKUP_CONCURRENCY = 4;

export function genreLookupOrder(books: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const candidates = books.filter(needsGenreMetadata);
  return [...candidates.filter(isFinishedBook), ...candidates.filter((book) => !isFinishedBook(book))];
}

export async function settleWithConcurrency<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await run(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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
