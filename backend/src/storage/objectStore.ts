import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ObjectStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  urlFor(key: string): string;
}

const OBJECT_KEY = /^(covers|gallery|avatars)\/[0-9a-f-]{36}(-thumb)?\.webp$/;

export function assertObjectKey(key: string): void {
  if (!OBJECT_KEY.test(key)) throw new Error("Invalid object key");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createFsObjectStore(root: string, publicBaseUrl: string): ObjectStore & { root: string } {
  return {
    root,
    async put(key, bytes) {
      assertObjectKey(key);
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      assertObjectKey(key);
      try {
        return await readFile(join(root, key));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      assertObjectKey(key);
      await rm(join(root, key), { force: true });
    },
    urlFor(key) {
      assertObjectKey(key);
      return `${publicBaseUrl}/files/${key}`;
    }
  };
}
