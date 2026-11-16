import { QUIZ_QUESTION_TYPES, type QuizQuestionType } from "@scripta/shared";

export const INITIAL_QUESTION_COUNT = 10;
export const INITIAL_SOURCE = "shelf";

export function quizCreateDirty(draft: { name: string; source: string; collectionId: string; poolIds: string[]; questionCount: number; allowedTypes: QuizQuestionType[] }): boolean {
  return draft.name.trim() !== ""
    || draft.source !== INITIAL_SOURCE
    || draft.collectionId !== ""
    || draft.poolIds.length > 0
    || draft.questionCount !== INITIAL_QUESTION_COUNT
    || draft.allowedTypes.length !== QUIZ_QUESTION_TYPES.length
    || QUIZ_QUESTION_TYPES.some((type) => !draft.allowedTypes.includes(type));
}
