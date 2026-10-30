export const DEV_THEMES = [
  { id: "cozy-mysteries", name: "Cozy mysteries" },
  { id: "space-adventures", name: "Space adventures" },
  { id: "gothic-stories", name: "Gothic stories" },
];

export const DEV_BOOKS = [
  { id: "dev-book-piranesi", title: "Piranesi", author: "Susanna Clarke", blurb: "A man tends the tides and statues of an endless house, and keeps careful notes on the only other person he believes exists." },
  { id: "dev-book-dracula", title: "Dracula", author: "Bram Stoker", blurb: "A young solicitor travels east to sell a London house to a count who never eats." },
  { id: "dev-book-frankenstein", title: "Frankenstein", author: "Mary Shelley", blurb: "A student builds a man from the dead and runs from him the moment he opens his eyes." },
  { id: "dev-book-1984", title: "1984", author: "George Orwell", blurb: "A records clerk rewrites yesterday's news and keeps a diary he must never be caught with." },
  { id: "dev-book-pride", title: "Pride and Prejudice", author: "Jane Austen", blurb: "Five unmarried sisters, one wealthy newcomer, and a proud friend everyone misjudges." },
  { id: "dev-book-hobbit", title: "The Hobbit", author: "J.R.R. Tolkien", blurb: "A comfortable homebody is hired as a burglar by thirteen dwarves and a wizard." },
  { id: "dev-book-dune", title: "Dune", author: "Frank Herbert", blurb: "On a desert planet that grows the most valuable substance in the universe, a duke's son survives his family's betrayal." },
  { id: "dev-book-brave", title: "Brave New World", author: "Aldous Huxley", blurb: "In a tidy future where everyone is happy by design, one man would rather be unhappy and free." },
  { id: "dev-book-rebecca", title: "Rebecca", author: "Daphne du Maurier", blurb: "A new bride arrives at a great house and finds the first wife's presence in every room." },
  { id: "dev-book-orient", title: "Murder on the Orient Express", author: "Agatha Christie", blurb: "A snowdrift stops a luxury train overnight, and by morning a passenger has been stabbed twelve times." },
  { id: "dev-book-name", title: "The Name of the Rose", author: "Umberto Eco", blurb: "A friar and his novice investigate a string of deaths in a medieval abbey with a forbidden library." },
  { id: "dev-book-hitchhiker", title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams", blurb: "The Earth is demolished for a bypass, and one man escapes with a friend who turns out to be an alien." },
  { id: "dev-book-jane", title: "Jane Eyre", author: "Charlotte Bronte", blurb: "An orphaned governess falls for her employer and learns what is locked in the attic." },
  { id: "dev-book-hundred", title: "One Hundred Years of Solitude", author: "Gabriel Garcia Marquez", blurb: "Seven generations of one family live and repeat themselves in a town that is founded and forgotten." },
  { id: "dev-book-left", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", blurb: "An envoy crosses an ice-bound world whose people have no fixed sex, hoping to bring it into an alliance." },
  { id: "dev-book-wind", title: "The Shadow of the Wind", author: "Carlos Ruiz Zafon", blurb: "A boy picks one book from a secret cemetery of forgotten ones and finds someone has been burning every copy." },
  { id: "dev-book-gatsby", title: "The Great Gatsby", author: "F. Scott Fitzgerald", blurb: "A young bond salesman watches his rich neighbour throw parties for a woman across the bay." },
  { id: "dev-book-solaris", title: "Solaris", author: "Stanislaw Lem", blurb: "Scientists orbiting an ocean planet are visited by copies of the people they have lost." },
  { id: "dev-book-hound", title: "The Hound of the Baskervilles", author: "Arthur Conan Doyle", blurb: "A family curse and a glowing beast on the moor bring a London detective out of the city." },
  { id: "dev-book-mansfield", title: "Northanger Abbey", author: "Jane Austen", blurb: "A young woman raised on gothic novels visits an old abbey and suspects its owner of terrible things." },
];

const GAP_DAYS = new Set([6, 13, 21]);
const DEV_SCORES = [5, 4, 5, 5, 3, 5, 2, 4, 5, 1, 5, 4];
const ALICE_SCORES = [4, 5, 3, 5, 4, 2];
const BOB_SCORES = [5, 3, 4, 5, 5];
const CHARLIE_SCORES = [3, 5, 2, 4];
const GUEST_EDITIONS = new Set([2, 8, 14]);
const RECENT_PLAYED = 3;

export const DEV_GUEST_ID = "00000000-0000-4000-8000-0000000000d1";

const DAY_MS = 86_400_000;

export function planDays(today) {
  const end = Date.parse(`${today}T00:00:00.000Z`);
  const first = new Date(end);
  first.setUTCDate(1);
  first.setUTCMonth(first.getUTCMonth() - 1);
  const days = [];
  for (let time = first.getTime(); time <= end; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (date === today || !GAP_DAYS.has(Number(date.slice(8)))) days.push(date);
  }
  return days;
}

export function planPlays(dates, today) {
  const past = dates.filter((date) => date < today);
  const plays = [];
  past.forEach((date, index) => {
    const devMissed = index < past.length - RECENT_PLAYED && (index % 7 === 3 || index === 5);
    if (!devMissed) plays.push({ date, who: "dev", score: DEV_SCORES[index % DEV_SCORES.length] });
    if (index % 5 !== 1) plays.push({ date, who: "alice", score: ALICE_SCORES[index % ALICE_SCORES.length] });
    if (index % 3 === 0) plays.push({ date, who: "bob", score: BOB_SCORES[index % BOB_SCORES.length] });
    if (index % 4 === 0) plays.push({ date, who: "charlie", score: CHARLIE_SCORES[index % CHARLIE_SCORES.length] });
    if (GUEST_EDITIONS.has(index)) plays.push({ date, who: "guest", score: 3 });
  });
  if (dates.includes(today)) {
    plays.push({ date: today, who: "alice", score: 4 }, { date: today, who: "bob", score: 5 });
  }
  return plays;
}

export function correctMarks(score, seed) {
  const wrong = new Set(Array.from({ length: 5 - score }, (_, step) => (seed + step * 2) % 5));
  return Array.from({ length: 5 }, (_, position) => !wrong.has(position));
}

export function buildEdition(date, index) {
  const theme = DEV_THEMES[index % DEV_THEMES.length];
  const start = (index * 5) % DEV_BOOKS.length;
  const questions = Array.from({ length: 5 }, (_, position) => {
    const at = (start + position) % DEV_BOOKS.length;
    const book = DEV_BOOKS[at];
    const answerIndex = (index + position) % 4;
    const distractors = [1, 2, 3].map((offset) => DEV_BOOKS[(at + offset * 3) % DEV_BOOKS.length].title);
    const options = [...distractors.slice(0, answerIndex), book.title, ...distractors.slice(answerIndex)];
    return {
      id: `dev-daily-${date}-q${position + 1}`,
      bookId: book.id,
      type: "blurb_title",
      prompt: book.blurb,
      options,
      answerIndex,
      explanation: `${book.title} is by ${book.author}.`,
      sourceUrl: "https://example.org/dev-fixture",
      sourceEdition: "Dev fixture",
      rights: { basis: "original", evidence: "Original dev fixture clue." },
      approvedAt: `${date}T00:00:00.000Z`,
      approvedBy: "dev-fixture",
      book: { id: book.id, title: book.title, author: book.author, language: "en", themeIds: [theme.id] },
    };
  });
  return {
    id: `dev-daily-${date}`,
    date,
    themeId: theme.id,
    title: `${theme.name}, ${date}`,
    intro: "A dev fixture chapter.",
    questionIds: questions.map((question) => question.id),
    snapshot: questions,
  };
}
