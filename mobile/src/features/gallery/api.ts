import { apiClient } from "../../core/api";

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
  return (await apiClient.request<{ images: GalleryImage[] }>("/gallery", { auth: true })).images;
}

export async function uploadGalleryImage(file: { uri: string; name: string; mimeType: string }): Promise<GalleryImage> {
  const form = new FormData();
  form.append("image", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  return (await apiClient.request<{ image: GalleryImage }>("/gallery", { method: "POST", body: form, auth: true })).image;
}

export async function deleteGalleryImage(id: string): Promise<void> {
  await apiClient.request(`/gallery/${id}`, { method: "DELETE", auth: true });
}
