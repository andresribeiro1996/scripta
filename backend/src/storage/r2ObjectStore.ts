import { AwsClient } from "aws4fetch";
import { assertObjectKey, type ObjectStore } from "./objectStore.js";

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function createR2ObjectStore(options: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicUrl: string }): ObjectStore {
  const client = new AwsClient({ accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, service: "s3", region: "auto" });
  const objectUrl = (key: string) => `${options.endpoint}/${options.bucket}/${key}`;
  return {
    async put(key, bytes, contentType) {
      assertObjectKey(key);
      const res = await client.fetch(objectUrl(key), { method: "PUT", body: new Uint8Array(bytes), headers: { "Content-Type": contentType, "Cache-Control": IMMUTABLE_CACHE_CONTROL } });
      if (!res.ok) throw new Error(`R2 PUT ${key} failed: HTTP ${res.status}`);
    },
    async get(key) {
      assertObjectKey(key);
      const res = await client.fetch(objectUrl(key), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 GET ${key} failed: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async delete(key) {
      assertObjectKey(key);
      const res = await client.fetch(objectUrl(key), { method: "DELETE" });
      if (res.status !== 204 && res.status !== 200 && res.status !== 404) throw new Error(`R2 DELETE ${key} failed: HTTP ${res.status}`);
    },
    urlFor(key) {
      assertObjectKey(key);
      return `${options.publicUrl}/${key}`;
    }
  };
}
