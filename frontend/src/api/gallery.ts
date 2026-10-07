import { createGalleryApi, type GalleryImage } from "@scripta/shared";
import { apiFetch } from "./client";
import { request } from "./request";

export type { GalleryImage } from "@scripta/shared";

export const { fetchGalleryImages, deleteGalleryImage } = createGalleryApi(request);

export async function uploadGalleryImage(file: File): Promise<GalleryImage> {
  const form = new FormData();
  form.append("image", file, file.name);
  const body = (await apiFetch("/gallery", { method: "POST", body: form })) as { image: GalleryImage };
  return body.image;
}
