import { AwsClient } from "aws4fetch";
import { assertObjectKey, ObjectStoreUnavailableError, type ObjectStore } from "./objectStore.js";

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

function failed(method: string, key: string, status: number): Error {
  const message = `R2 ${method} ${key} failed: HTTP ${status}`;
  return status === 429 || status >= 500 ? new ObjectStoreUnavailableError(message) : new Error(message);
}

export function createR2ObjectStore(options: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicUrl: string }): ObjectStore {
  const client = new AwsClient({ accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, service: "s3", region: "auto" });
  const timeout = () => AbortSignal.timeout(15_000);
  const objectUrl = (key: string) => `${options.endpoint}/${options.bucket}/${key}`;
  async function request<T>(method: string, key: string, init: RequestInit, read: (res: Response) => Promise<T>): Promise<T> {
    try {
      return await read(await client.fetch(objectUrl(key), { ...init, method, signal: timeout() }));
    } catch (error) {
      if (error instanceof TypeError || (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))) {
        throw new ObjectStoreUnavailableError(`R2 ${method} ${key} failed: ${error.message}`);
      }
      throw error;
    }
  }
  return {
    async put(key, bytes, contentType) {
      assertObjectKey(key);
      await request("PUT", key, { body: new Uint8Array(bytes), headers: { "Content-Type": contentType, "Cache-Control": IMMUTABLE_CACHE_CONTROL } }, async (res) => {
        if (!res.ok) throw failed("PUT", key, res.status);
      });
    },
    async get(key) {
      assertObjectKey(key);
      return request("GET", key, {}, async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw failed("GET", key, res.status);
        return Buffer.from(await res.arrayBuffer());
      });
    },
    async delete(key) {
      assertObjectKey(key);
      await request("DELETE", key, {}, async (res) => {
        if (res.status !== 204 && res.status !== 200 && res.status !== 404) throw failed("DELETE", key, res.status);
      });
    },
    urlFor(key) {
      assertObjectKey(key);
      return `${options.publicUrl}/${key}`;
    }
  };
}
