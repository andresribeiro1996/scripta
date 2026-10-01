import { env } from "../config/env.js";
import { createFsObjectStore, type ObjectStore } from "./objectStore.js";
import { createR2ObjectStore } from "./r2ObjectStore.js";

let shared: ObjectStore | undefined;

export function createObjectStore(): ObjectStore {
  shared ??= env.R2_IMAGES_BUCKET
    ? createR2ObjectStore({
        endpoint: env.R2_ENDPOINT,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_IMAGES_BUCKET,
        publicUrl: env.R2_IMAGES_PUBLIC_URL
      })
    : createFsObjectStore(env.FILES_STORAGE_PATH, env.PUBLIC_API_URL);
  return shared;
}
