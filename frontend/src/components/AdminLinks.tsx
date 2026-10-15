import { Link } from "react-router-dom";

export function AdminLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  if (!isAdmin) return null;
  return (
    <Link
      to="/admin/genres"
      onClick={onNavigate}
      className="mb-2 block rounded-lg px-3 py-2 text-sm text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
    >
      Genre review
    </Link>
  );
}
