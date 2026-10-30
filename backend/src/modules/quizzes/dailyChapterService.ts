import { createHash, randomUUID } from "node:crypto";
import { DAILY_CHAPTER_QUOTE_RIGHTS, DAILY_CHAPTER_THEMES, dailyChapterCoverage, dailyChapterStats, dailyChapterSummary, gradeAnswers, type DailyChapterBoard, type DailyChapterBook, type DailyChapterEditionInput, type DailyChapterPerson, type DailyChapterQuestionInput, type DailyChapterResult, type SubmittedAnswer } from "@scripta/shared";
import { DailyChapterError, NO_DAILY_PEOPLE, type DailyChapterPeople, type DailyChapterRepository, type StoredDailyChapter } from "./domain/dailyChapter.js";
import type { QuizzesRepository } from "./domain/ports.js";
import type { PlayRow } from "./domain/types.js";
import { dailyBankSchema, dailyBookSchema, dailyEditionSchema, dailyImportSchema, dailyQuestionSchema } from "./dailyChapterValidation.js";

export const dailyGuestKey = (id: string) => "daily-guest:" + id;
const fail = (status: number, message: string): never => { throw new DailyChapterError(status, message); };
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
const bookIdentity = (book: DailyChapterBook) => [normalized(book.title), normalized(book.author), book.language].join("\0");
const passageKey = (question: Pick<DailyChapterQuestionInput, "bookId" | "type" | "prompt">) => [question.bookId, question.type, normalized(question.prompt)].join("\0");

export function createDailyChapterService(repo: DailyChapterRepository, plays: QuizzesRepository, clock: () => Date = () => new Date(), people: DailyChapterPeople = NO_DAILY_PEOPLE) {
  const today = () => clock().toISOString().slice(0, 10);
  const editionResult = (edition: StoredDailyChapter, play: PlayRow): DailyChapterResult => {
    const given = new Map(plays.getAnswers(play.id).map((answer) => [answer.question_id, answer.choice_index]));
    return { editionId: edition.id, date: edition.date, title: edition.title, themeId: edition.themeId, score: play.score, completedAt: play.created_at,
      answers: edition.snapshot!.map((q) => ({ questionId: q.id, prompt: q.prompt, choiceIndex: given.get(q.id)!, answerIndex: q.answerIndex, options: q.options, explanation: q.explanation, sourceUrl: q.sourceUrl, book: q.book })) };
  };
  const usedQuestions = () => new Set(repo.editions().filter((edition) => edition.publishedAt).flatMap((edition) => edition.questionIds));
  const history = (playerId: string, guestId?: string) => {
    if (guestId && playerId !== dailyGuestKey(guestId)) repo.claimGuest(dailyGuestKey(guestId), playerId);
    const editions = repo.editions().filter((edition) => edition.publishedAt && edition.date <= today());
    const byId = new Map(editions.map((edition) => [edition.id, edition]));
    const results = repo.plays(playerId).flatMap((play) => { const edition = byId.get(play.quiz_id); return edition ? [editionResult(edition, play)] : []; });
    return dailyChapterStats(results, editions, today());
  };
  return {
    today() {
      const date = today();
      const nextAt = new Date(Date.parse(date + "T00:00:00.000Z") + 86_400_000).toISOString();
      const edition = repo.editions().find((item) => item.date === date && item.publishedAt);
      const board: DailyChapterBoard | null = edition ? { id: edition.id, date, closesAt: nextAt, title: edition.title, intro: edition.intro, theme: DAILY_CHAPTER_THEMES.find((theme) => theme.id === edition.themeId)!, questions: edition.snapshot!.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options })) } : null;
      return { board, date, nextAt };
    },
    history,
    people(editionId: string, viewerId: string): DailyChapterPerson[] {
      const edition = repo.edition(editionId);
      if (!edition?.publishedAt || edition.date > today()) return fail(404, "No daily edition at that link.");
      if (!plays.getPlayByVoter(editionId, viewerId)) return fail(403, "Play this chapter to see how others did.");
      const followees = people.followees(viewerId).filter((id) => id !== viewerId);
      const visible = people.published(followees);
      const ids = [viewerId, ...new Set(followees.filter((id) => visible.has(id)))];
      const profiles = people.profiles(ids);
      const named = ids.filter((id) => id === viewerId || profiles.has(id));
      return repo.editionPlays([editionId], named).flatMap((play) => {
        const given = new Map(plays.getAnswers(play.id).map((answer) => [answer.question_id, answer.choice_index]));
        const profile = profiles.get(play.voter_user_id!);
        const you = play.voter_user_id === viewerId;
        return [{ userId: play.voter_user_id!, username: profile?.username ?? "You", avatarUrl: profile?.avatarUrl ?? null, score: play.score, marks: edition.snapshot!.map((q) => given.get(q.id) === q.answerIndex), you }];
      }).sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
    },
    player(userId: string, viewerId: string | null) {
      if (viewerId !== userId && !people.published([userId]).has(userId)) return null;
      const played = history(userId);
      return played.results.length ? dailyChapterSummary(played, today().slice(0, 7)) : null;
    },
    play(id: string, playerId: string, submitted: SubmittedAnswer[]) {
      const acceptedAt = clock();
      const date = acceptedAt.toISOString().slice(0, 10);
      const edition = repo.edition(id);
      if (!edition?.publishedAt || edition.date > date) return fail(404, "No daily edition at that link.");
      const existing = plays.getPlayByVoter(id, playerId);
      if (existing) return editionResult(edition, existing);
      if (edition.date !== date) return fail(403, "This daily edition has closed. Come back for today's chapter.");
      const questions = edition.snapshot!;
      const choices = new Map(submitted.map((answer) => [answer.questionId, answer.choiceIndex]));
      if (submitted.length !== 5 || choices.size !== 5 || questions.some((q) => !Number.isInteger(choices.get(q.id)) || choices.get(q.id)! < 0 || choices.get(q.id)! >= q.options.length)) return fail(400, "Answer each of the five questions exactly once.");
      const graded = gradeAnswers(questions, submitted);
      const at = acceptedAt.toISOString();
      const play: PlayRow = { id: randomUUID(), quiz_id: id, voter_user_id: playerId, player_name: null, score: graded.score, duration_ms: 0, created_at: at, updated_at: at };
      try {
        plays.savePlay(play, submitted.map((answer) => ({ play_id: play.id, quiz_id: id, question_id: answer.questionId, choice_index: answer.choiceIndex, correct: graded.correct[answer.questionId] ? 1 : 0 })));
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint failed: quiz_plays.quiz_id, quiz_plays.voter_user_id")) throw error;
        const saved = plays.getPlayByVoter(id, playerId);
        if (!saved) throw error;
        return editionResult(edition, saved);
      }
      return editionResult(edition, play);
    },
    editorial() {
      const books = repo.books();
      const questions = repo.questions();
      const used = usedQuestions();
      return { books, questions, editions: repo.editions().map(({ snapshot: _snapshot, ...edition }) => edition), coverage: dailyChapterCoverage(books, questions, [...used]), usedQuestionIds: [...used] };
    },
    saveBook(input: DailyChapterBook) {
      const book = dailyBookSchema.parse(input);
      if (repo.books().some((item) => item.id !== book.id && normalized(item.title) === normalized(book.title) && normalized(item.author) === normalized(book.author) && item.language === book.language)) return fail(409, "That book and language are already on the target list.");
      const previous = repo.books().find((item) => item.id === book.id);
      if (previous && (previous.title !== book.title || previous.author !== book.author || previous.language !== book.language) && repo.questions().some((q) => q.bookId === book.id && q.approvedAt)) return fail(409, "Unapprove this book's questions before changing its title, author or language.");
      repo.saveBook(book);
    },
    saveQuestion(input: DailyChapterQuestionInput, userId: string) {
      const { approved, ...question } = dailyQuestionSchema.parse(input);
      const book = repo.books().find((item) => item.id === question.bookId);
      if (!book) return fail(400, "Add the target book before its question.");
      if (question.options[question.answerIndex] !== book.title) return fail(400, "The correct answer must be the target book's title.");
      if (repo.questions().some((q) => q.id !== question.id && passageKey(q) === passageKey(question))) return fail(409, "This passage or clue is already in the bank.");
      repo.saveQuestion({ ...question, approvedAt: approved ? clock().toISOString() : null, approvedBy: approved ? userId : null });
    },
    saveEdition(input: DailyChapterEditionInput) {
      const value = dailyEditionSchema.parse(input);
      if (value.date < today()) return fail(400, "Schedule an edition for today or a future date.");
      if (repo.editions().some((edition) => edition.id !== value.id && edition.date === value.date)) return fail(409, "That date already has an edition.");
      if (plays.getById(value.id)) return fail(409, "Choose a different edition id.");
      if (!repo.saveEdition({ ...value, snapshot: null, publishedAt: null })) return fail(409, "Scheduled editions are immutable. Create a new draft instead.");
    },
    publish(id: string) {
      const edition = repo.edition(id);
      if (!edition) return fail(404, "No draft with that id.");
      if (edition.publishedAt) return fail(409, "This edition is already scheduled.");
      if (edition.date < today()) return fail(400, "Schedule this draft for today or a future date first.");
      const books = new Map(repo.books().map((book) => [book.id, book]));
      const bank = new Map(repo.questions().map((q) => [q.id, q]));
      const used = usedQuestions();
      const questions = edition.questionIds.map((id) => {
        const q = bank.get(id);
        if (!q?.approvedAt) return fail(400, "Review and approve all five questions before scheduling.");
        dailyQuestionSchema.parse({ ...q, approved: true });
        const book = books.get(q.bookId);
        if (!book || !book.themeIds.includes(edition.themeId)) return fail(400, "Every book must belong to this edition's theme.");
        if (q.options[q.answerIndex] !== book.title) return fail(400, "A correct answer no longer matches its book.");
        if (used.has(id)) return fail(400, "One of these questions has already been scheduled. Use fresh material.");
        return { ...q, book };
      });
      if (new Set(questions.map((q) => q.bookId)).size !== 5) return fail(400, "Use five different books in an edition.");
      if (!repo.publish(id, questions, clock().toISOString())) return fail(409, "This edition is already scheduled.");
    },
    importBank(input: unknown) {
      const { books, questions } = dailyBankSchema.parse(input);
      if (new Set(books.map((book) => book.id)).size !== books.length || new Set(questions.map((question) => question.id)).size !== questions.length) return fail(400, "The bank has duplicate ids. Nothing was imported.");
      const existingBooks = repo.books();
      const byId = new Map(existingBooks.map((book) => [book.id, book]));
      const identities = new Map(existingBooks.map((book) => [bookIdentity(book), book.id]));
      for (const book of books) {
        const previous = byId.get(book.id);
        if ((previous && bookIdentity(previous) !== bookIdentity(book)) || (identities.has(bookIdentity(book)) && identities.get(bookIdentity(book)) !== book.id)) return fail(409, "A target book conflicts with an existing identity. Nothing was imported.");
        byId.set(book.id, previous ?? book);
        identities.set(bookIdentity(book), book.id);
      }
      const existingQuestions = repo.questions();
      const questionIds = new Map(existingQuestions.map((question) => [question.id, question]));
      const passages = new Map(existingQuestions.map((question) => [passageKey(question), question.id]));
      for (const question of questions) {
        const book = byId.get(question.bookId);
        if (!book || book.title !== question.options[question.answerIndex]) return fail(400, "Every correct answer must match a target book. Nothing was imported.");
        const previous = questionIds.get(question.id);
        if ((previous && passageKey(previous) !== passageKey(question)) || (passages.has(passageKey(question)) && passages.get(passageKey(question)) !== question.id)) return fail(409, "A passage or question id is already in the bank. Nothing was imported.");
        passages.set(passageKey(question), question.id);
      }
      repo.importDrafts(books, questions.map(({ approved: _approved, ...question }) => ({ ...question, approvedAt: null, approvedBy: null })), []);
    },
    importPack(input: unknown, userId?: string) {
      const { pack, startDate } = dailyImportSchema.parse(input);
      const reviewed = pack.status === "editorial-reviewed";
      if (reviewed && !userId) return fail(400, "Reviewed imports require the authenticated editor.");
      if (startDate < today()) return fail(400, "Choose today or a future start date.");
      const books = new Map<string, DailyChapterBook>();
      const questions = [];
      const editions: StoredDailyChapter[] = [];
      for (const edition of pack.editions) {
        const date = new Date(startDate + "T00:00:00.000Z");
        date.setUTCDate(date.getUTCDate() + edition.day - 1);
        const questionIds = [];
        for (const q of edition.questions) {
          const bookId = "book-" + createHash("sha256").update(q.book.title + "\0" + q.book.author + "\0" + pack.language).digest("hex").slice(0, 24);
          const previous = books.get(bookId);
          books.set(bookId, dailyBookSchema.parse({ id: bookId, title: q.book.title, author: q.book.author, language: pack.language, themeIds: [...new Set([...(previous?.themeIds ?? []), edition.themeId])] }));
          const parsed = dailyQuestionSchema.parse({ id: q.id, bookId, type: q.type, prompt: q.prompt, options: q.options, answerIndex: q.answerIndex, explanation: q.explanation, sourceUrl: q.book.sourceUrl, sourceEdition: q.sourceEdition, rights: q.rights ?? (q.type === "quote_title" ? { ...DAILY_CHAPTER_QUOTE_RIGHTS } : { basis: "original", evidence: "Original clue written for The Daily Chapter." }), approved: reviewed });
          if (parsed.options[parsed.answerIndex] !== q.book.title) return fail(400, "An imported answer does not match its target book. Nothing was imported.");
          const { approved: _approved, ...data } = parsed;
          questions.push({ ...data, approvedAt: reviewed ? clock().toISOString() : null, approvedBy: reviewed ? userId! : null });
          questionIds.push(q.id);
        }
        const data = dailyEditionSchema.parse({ id: edition.id, date: date.toISOString().slice(0, 10), themeId: edition.themeId, title: edition.title, intro: edition.intro, questionIds });
        if (reviewed && new Set(edition.questions.map((q) => q.book.title + "\0" + q.book.author)).size !== 5) return fail(400, "A reviewed edition needs five different books. Nothing was imported.");
        editions.push({ ...data, snapshot: null, publishedAt: null });
      }
      if (new Set(editions.map((edition) => edition.id)).size !== editions.length || new Set(editions.map((edition) => edition.date)).size !== editions.length || new Set(questions.map((q) => q.id)).size !== questions.length) return fail(400, "The import has duplicate edition dates or ids.");
      const existingBooks = repo.books();
      const identities = new Map(existingBooks.map((book) => [bookIdentity(book), book.id]));
      for (const book of books.values()) {
        const previous = existingBooks.find((item) => item.id === book.id);
        if ((previous && bookIdentity(previous) !== bookIdentity(book)) || (identities.has(bookIdentity(book)) && identities.get(bookIdentity(book)) !== book.id)) return fail(409, "An imported book conflicts with an existing identity. Nothing was imported.");
        identities.set(bookIdentity(book), book.id);
      }
      if (reviewed) {
        const existingQuestions = repo.questions();
        const passages = new Map(existingQuestions.map((question) => [passageKey(question), question.id]));
        for (const question of questions) {
          const previous = existingQuestions.find((q) => q.id === question.id);
          if (previous && passageKey(previous) !== passageKey(question)) return fail(409, "A reviewed question id belongs to different content. Nothing was imported.");
          if (passages.has(passageKey(question)) && passages.get(passageKey(question)) !== question.id) return fail(409, "Reuse the existing passage id in the reviewed pack. Nothing was imported.");
          passages.set(passageKey(question), question.id);
        }
      }
      if (editions.some((edition) => plays.getById(edition.id))) return fail(409, "An edition id belongs to another quiz. Nothing was imported.");
      const existing = repo.editions();
      const moved = editions.find((edition) => existing.some((item) => item.id === edition.id && item.date !== edition.date));
      if (moved) return fail(409, "Edition " + moved.id + " is already on " + existing.find((item) => item.id === moved.id)!.date + ". Remove it or keep its date.");
      if (editions.some((edition) => existing.some((item) => item.date === edition.date && item.id !== edition.id))) return fail(409, "An imported date is already occupied. Nothing was imported.");
      repo.importDrafts([...books.values()], questions, editions);
    }
  };
}

export type DailyChapterService = ReturnType<typeof createDailyChapterService>;
