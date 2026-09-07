// A minimal client for the SAME backend gallery module Task 5B's own
// mobile/src/features/gallery/ owns — this feature only needs "list
// images" and "upload one" for the book-cover picker (see
// components/CoverPickerSheet.tsx), not the full gallery management UI.
// Duplicated on purpose rather than importing across feature boundaries
// (forbidden — see this task's own file-ownership rules); Task 6's
// integration pass should consolidate this with 5B's gallery client if
// one lands with the same shape. See this task's handoff notes.

import { authorizedFetch } from "./multipartFetch";

/** Mirrors the backend's GalleryImage shape (modules/gallery/domain/
 *  types.ts) — same as frontend's api/gallery.ts's GalleryImage. */
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
  const body = await authorizedFetch<{ images: GalleryImage[] }>("/gallery", { method: "GET" });
  return body.images;
}

/** `uri` is a local file:// (or content://, already copied to cache —
 *  see expo-image-picker's own default) path, as returned by
 *  expo-image-picker — never read into JS memory, RN's FormData/fetch
 *  streams it from disk the same way a web File does. */
export async function uploadGalleryImage(file: { uri: string; name: string; mimeType: string }): Promise<GalleryImage> {
  const form = new FormData();
  form.append("image", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  const body = await authorizedFetch<{ image: GalleryImage }>("/gallery", { method: "POST", body: form });
  return body.image;
}

export async function deleteGalleryImage(id: string): Promise<void> {
  await authorizedFetch(`/gallery/${id}`, { method: "DELETE" });
}
