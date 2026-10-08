import { createReaderCardApi } from "@scripta/shared";
import { request } from "./request";

export const { fetchReaderCardStyle, updateReaderCardStyle, fetchReaderNumber } = createReaderCardApi(request);
