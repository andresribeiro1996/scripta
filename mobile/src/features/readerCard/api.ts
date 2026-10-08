import { createReaderCardApi } from "@scripta/shared";
import { request } from "../../core/api";

export const { fetchReaderCardStyle, updateReaderCardStyle, fetchReaderNumber } = createReaderCardApi(request);
