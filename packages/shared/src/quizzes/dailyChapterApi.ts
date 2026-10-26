import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { SubmittedAnswer } from "./types.js";
import type { DailyChapterBoard, DailyChapterBook, DailyChapterEditionInput, DailyChapterEditorial, DailyChapterHistory, DailyChapterQuestionInput, DailyChapterResult } from "./dailyChapter.js";

export function createDailyChapterApi(request: ApiRequest) {
  return {
    today: () => request<{ board: DailyChapterBoard | null; date: string; nextAt: string }>("/daily-chapter/today", { auth: "none" }),
    history: (guestId: string) => request<DailyChapterHistory>("/daily-chapter/history", { method: "POST", body: { guestId }, auth: "optional" }),
    play: (id: string, guestId: string, answers: SubmittedAnswer[]) => request<DailyChapterResult>(apiPath`/daily-chapter/${id}/play`, { method: "POST", body: { guestId, answers }, auth: "optional" }),
    editorial: () => request<DailyChapterEditorial>("/daily-chapter/admin", { auth: "required" }),
    saveBook: (book: DailyChapterBook) => request("/daily-chapter/admin/books", { method: "PUT", body: book, auth: "required" }),
    saveQuestion: (question: DailyChapterQuestionInput) => request("/daily-chapter/admin/questions", { method: "PUT", body: question, auth: "required" }),
    saveEdition: (edition: DailyChapterEditionInput) => request("/daily-chapter/admin/editions", { method: "PUT", body: edition, auth: "required" }),
    publish: (id: string) => request(apiPath`/daily-chapter/admin/editions/${id}/publish`, { method: "POST", auth: "required" }),
    importPack: (pack: unknown, startDate: string) => request("/daily-chapter/admin/import", { method: "POST", body: { pack, startDate }, auth: "required" }),
    importBank: (bank: unknown) => request("/daily-chapter/admin/import-bank", { method: "POST", body: bank, auth: "required" }),
  };
}
