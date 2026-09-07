import { ApiError } from "../../core/api";
import { API_URL } from "../../core/config";
import { getAccessToken } from "../../core/tokenStore";
import type { ImportFile, ImportPreview } from "./types";

export async function uploadImportPreview(file: ImportFile): Promise<ImportPreview> {
  const token = getAccessToken();
  if (!token) throw new ApiError(401, "Not signed in");
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as unknown as Blob);
  const response = await fetch(`${API_URL}/library/import/preview`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new ApiError(response.status, typeof body === "object" && body !== null && "error" in body ? String(body.error) : `Request failed (${response.status})`);
  }
  return body as ImportPreview;
}
