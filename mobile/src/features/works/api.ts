import { createWorksApi } from "@scripta/shared";
import { request } from "../../core/api";

export const { fetchWork, fetchWorkStats } = createWorksApi(request);
