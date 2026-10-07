import { createGalleryApi, type GalleryImage } from "@scripta/shared";
import { File } from "expo-file-system";
import { apiClient, request } from "../../core/api";

export type { GalleryImage } from "@scripta/shared";

export const { fetchGalleryImages, deleteGalleryImage } = createGalleryApi(request);

export async function uploadGalleryImage(file: { uri: string; name: string; mimeType: string }): Promise<GalleryImage> {
  const form = new FormData();
  form.append("image", new File(file.uri));
  return (await apiClient.request<{ image: GalleryImage }>("/gallery", { method: "POST", body: form, auth: true })).image;
}
