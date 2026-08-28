import { apiFetch } from "./client";

/** Mirrors the backend's GalleryImage shape (modules/gallery/domain/types.ts)
 *  — `url` is a plain, unauthenticated URL usable directly as an
 *  `<img src>`, same as the Kobo/Open Library cover URLs BookCard already
 *  loads (see lib/covers.ts). */
export interface GalleryImage {
  id: string;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
  url: string;
}

export async function fetchGalleryImages(): Promise<GalleryImage[]> {
  const body = (await apiFetch("/gallery")) as { images: GalleryImage[] };
  return body.images;
}

/** multipart/form-data, not JSON — see api/client.ts's rawFetch for the
 *  FormData carve-out that makes this work through the same apiFetch
 *  every other authenticated call goes through (auth header, 401 refresh
 *  retry, all still apply). */
export async function uploadGalleryImage(file: File): Promise<GalleryImage> {
  const form = new FormData();
  form.append("image", file, file.name);
  const body = (await apiFetch("/gallery", { method: "POST", body: form })) as { image: GalleryImage };
  return body.image;
}

export async function deleteGalleryImage(id: string): Promise<void> {
  await apiFetch(`/gallery/${id}`, { method: "DELETE" });
}
