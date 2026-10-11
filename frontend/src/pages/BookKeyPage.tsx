import { Navigate, useNavigate, useParams } from "react-router-dom";
import { bookKey } from "@scripta/shared";
import { BookScreen } from "../components/book/BookScreen";
import { EmptyState } from "../components/EmptyState";
import { useLibrary } from "../hooks/useLibrary";

export function BookKeyPage() {
  const { key = "" } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { data: library, isLoading } = useLibrary();
  const workId = library?.works?.[key];
  const book = library?.data.books.find((b) => bookKey(b) === key) ?? null;
  if (workId) return <Navigate to={`/work/${workId}`} replace />;
  if (isLoading) return <main className="mx-auto max-w-5xl px-5 py-8"><p className="text-sm text-(--color-text-dim)">Loading…</p></main>;
  if (!book) return <main className="mx-auto max-w-5xl px-5 py-8"><EmptyState title="Book not found" /></main>;
  return <BookScreen page={null} book={book} signedIn onAdd={() => {}} onShare={null} onBack={() => navigate(-1)} backTo="/dashboard/library" />;
}
