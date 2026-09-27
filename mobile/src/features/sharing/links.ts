import { apiClient } from "../../core/api";
import { contentUrl } from "./shareImage";

export async function publicContentUrl(path: string) {
  const { frontendUrl } = await apiClient.request<{ frontendUrl: string }>("/public-config");
  return contentUrl(frontendUrl, path);
}
