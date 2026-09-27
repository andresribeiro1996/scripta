export function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
      <span className="text-lg font-bold">Atmyshelf</span>
    </span>
  );
}
