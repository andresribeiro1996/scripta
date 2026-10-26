import { z } from "zod";
import { DAILY_CHAPTER_THEMES } from "@scripta/shared";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
export const dailyDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const date = new Date(value + "T00:00:00.000Z"); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, "Invalid calendar date.");
const theme = z.string().refine((value) => DAILY_CHAPTER_THEMES.some((item) => item.id === value), "Unknown theme.");
const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/, "Enter a language code such as en or pt.");
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const text = z.string().trim().min(1, "Complete the required text fields before saving.").max(4000);
const sourceUrl = z.string().url("Enter a valid source URL.").max(2000).refine((value) => new URL(value).protocol === "https:", "Use an HTTPS source URL.");
const rights = z.object({ basis: z.enum(["original", "public-domain", "permission"]), evidence: z.string().trim().max(4000) });
export const dailyBookSchema = z.object({ id, title: text.max(300), author: text.max(300), language, themeIds: z.array(theme).min(1).max(40).refine(unique) });
export const dailyQuestionSchema = z.object({
  id, bookId: id, type: z.enum(["quote_title", "blurb_title"]), prompt: text.max(2000),
  options: z.array(text.max(300)).length(4).refine((options) => unique(options.map((option) => option.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " "))), "Answer choices must be distinct."),
  answerIndex: z.number().int().min(0).max(3), explanation: text,
  sourceUrl, sourceEdition: z.string().trim().max(1000),
  rights, approved: z.boolean()
}).superRefine((question, ctx) => {
  if (!question.approved) return;
  if (question.rights.evidence.length < 10) ctx.addIssue({ code: "custom", message: "Record the source and reuse assessment before approval." });
  if (question.type === "quote_title" && (question.rights.basis === "original" || !question.sourceEdition)) ctx.addIssue({ code: "custom", message: "A quotation needs its source edition and public-domain or permission evidence." });
});
export const dailyEditionSchema = z.object({ id, date: dailyDateSchema, themeId: theme, title: text.max(200), intro: text.max(500), questionIds: z.array(id).length(5).refine(unique, "Use five distinct questions.") });
export const dailyBankSchema = z.object({ books: z.array(dailyBookSchema).min(1).max(1000), questions: z.array(dailyQuestionSchema).max(5000).refine((questions) => questions.every((question) => !question.approved), "Bank imports must contain unapproved candidates.") });
export const dailyPlayerSchema = z.object({ guestId: z.string().uuid().optional() });
export const dailyPlaySchema = dailyPlayerSchema.extend({ answers: z.array(z.object({ questionId: id, choiceIndex: z.number().int().min(0).max(3) })).length(5).refine((answers) => unique(answers.map((answer) => answer.questionId)), "Answer each question once.") });
export const dailyImportSchema = z.object({ startDate: dailyDateSchema, pack: z.object({
  status: z.enum(["editorial-draft", "editorial-reviewed"]).default("editorial-draft"),
  language: language.default("en"),
  editions: z.array(z.object({ id, day: z.number().int().min(1).max(366), themeId: theme, title: text.max(200), intro: text.max(500), questions: z.array(z.object({ id, type: z.enum(["quote_title", "blurb_title"]), prompt: text.max(2000), options: z.array(text.max(300)).length(4), answerIndex: z.number().int().min(0).max(3), book: z.object({ title: text.max(300), author: text.max(300), sourceUrl }), explanation: text, sourceEdition: z.string().trim().max(1000).default(""), rights: rights.optional() })).length(5) })).min(1).max(100)
}) });
