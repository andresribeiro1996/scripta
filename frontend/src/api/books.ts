import { apiFetch } from "./client";
import type { ResolveCoverParams } from "./covers";

function lookupQuery(params: ResolveCoverParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.isbn) query.set("isbn", params.isbn);
  if (params.title) query.set("title", params.title);
  if (params.author) query.set("author", params.author);
  return query;
}

export async function fetchIsAdmin(): Promise<boolean> {
  return ((await apiFetch("/books/admin")) as { isAdmin: boolean }).isAdmin;
}

export async function rejectSharedCover(params: ResolveCoverParams): Promise<void> {
  await apiFetch("/books/cover/reject", {
    method: "POST",
    body: JSON.stringify({ isbn: params.isbn, title: params.title, author: params.author })
  });
}

export async function uploadSharedCover(params: ResolveCoverParams, file: File): Promise<{ url: string | null; fullUrl: string | null }> {
  const form = new FormData();
  form.append("image", file);
  return (await apiFetch(`/books/cover?${lookupQuery(params)}`, { method: "PUT", body: form })) as { url: string | null; fullUrl: string | null };
}
