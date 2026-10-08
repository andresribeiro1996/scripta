import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { ReaderCardStyle, ReaderCardStylePatch } from "./style.js";

export function createReaderCardApi(request: ApiRequest) {
  return {
    fetchReaderCardStyle(): Promise<ReaderCardStyle> {
      return request<ReaderCardStyle>(apiPath`/library/reader-card/style`, { auth: "required" });
    },
    fetchReaderNumber(): Promise<number | null> {
      return request<{ readerNumber: number | null }>(apiPath`/library/reader-card/number`, { auth: "required" }).then((body) => body.readerNumber);
    },
    updateReaderCardStyle(patch: ReaderCardStylePatch): Promise<ReaderCardStyle> {
      return request<ReaderCardStyle>(apiPath`/library/reader-card/style`, { method: "PATCH", body: patch, auth: "required" });
    },
  };
}

export type ReaderCardApi = ReturnType<typeof createReaderCardApi>;
