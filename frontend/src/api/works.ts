import { createWorksApi } from "@scripta/shared";
import { request } from "./request";

export const { fetchWork } = createWorksApi(request);
