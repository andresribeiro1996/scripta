import { UploadType, type File } from "expo-file-system";
import { ApiError } from "../../core/api";
import { API_URL } from "../../core/config";
import { getAccessToken } from "../../core/tokenStore";
import type { ImportPreview } from "./types";

export async function uploadImportPreview(file: File): Promise<ImportPreview> {
  const token = getAccessToken();
  if (!token) throw new ApiError(401, "Not signed in");
  const response = await file.upload(`${API_URL}/library/import/preview`, {
    httpMethod: "POST",
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.type || "application/octet-stream",
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = response.body;
  let body: unknown = {};
  try {
    if (text) body = JSON.parse(text);
  } catch {
    throw new ApiError(response.status, response.status >= 200 && response.status < 300 ? "Server returned an invalid response" : `Request failed (${response.status})`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(response.status, typeof body === "object" && body !== null && "error" in body ? String(body.error) : `Request failed (${response.status})`);
  }
  return body as ImportPreview;
}
