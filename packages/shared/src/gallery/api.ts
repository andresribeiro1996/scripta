import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { GalleryImage } from "./types.js";

export function createGalleryApi(request: ApiRequest) {
  return {
    async fetchGalleryImages(): Promise<GalleryImage[]> {
      return (await request<{ images: GalleryImage[] }>("/gallery", { auth: "required" })).images;
    },
    async deleteGalleryImage(id: string): Promise<void> {
      await request(apiPath`/gallery/${id}`, { method: "DELETE", auth: "required" });
    },
  };
}
