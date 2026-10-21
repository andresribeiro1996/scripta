import { createTopShelfApi } from "@scripta/shared";
import { request } from "../../core/api";

export const { fetchTopShelf, fetchRecapIndex, fetchRecap } = createTopShelfApi(request);
