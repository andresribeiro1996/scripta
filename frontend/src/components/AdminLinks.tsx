import { Link } from "react-router-dom";

const LINKS = [
  { to: "/admin/genres", label: "Genre review" },
  { to: "/admin/synopses", label: "Synopsis review" },
  { to: "/admin/translations", label: "Translation review" }
];

export function AdminLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  if (!isAdmin) return null;
  return (
    <>
      {LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          onClick={onNavigate}
          className="mb-2 block rounded-lg px-3 py-2 text-sm text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}
