import { createTopShelfApi } from "@scripta/shared";
import { request } from "../../core/api";

export const { fetchTopShelf } = createTopShelfApi(request);
