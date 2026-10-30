import { createTopShelfApi } from "@scripta/shared";
import { request } from "./request";

export const { fetchTopShelf } = createTopShelfApi(request);
