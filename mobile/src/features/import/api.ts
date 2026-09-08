import { File } from "expo-file-system";
import { ApiError } from "../../core/api";
import { API_URL } from "../../core/config";
import { getAccessToken } from "../../core/tokenStore";
import type { ImportFile, ImportPreview } from "./types";

export async function uploadImportPreview(file: ImportFile): Promise<ImportPreview> {
  const token = getAccessToken();
  if (!token) throw new ApiError(401, "Not signed in");
  const form = new FormData();
  form.append("file", new File(file.uri));
  const response = await fetch(`${API_URL}/library/import/preview`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const text = await response.text();
  let body: unknown = {};
  try {
    if (text) body = JSON.parse(text);
  } catch {
    throw new ApiError(response.status, response.ok ? "Server returned an invalid response" : `Request failed (${response.status})`);
  }
  if (!response.ok) {
    throw new ApiError(response.status, typeof body === "object" && body !== null && "error" in body ? String(body.error) : `Request failed (${response.status})`);
  }
  return body as ImportPreview;
}
