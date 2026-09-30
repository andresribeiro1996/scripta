import { BrandMark } from "./BrandMark";

export function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <BrandMark size={28} />
      <span className="text-lg font-bold">Atmyshelf</span>
    </span>
  );
}
