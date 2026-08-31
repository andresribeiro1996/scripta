import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="sticky top-0 z-30 bg-(--color-accent-soft) px-4 py-2 text-center text-sm font-medium text-(--color-accent)">
      Offline — showing your last synced library. Changes won't save until you're back online.
    </div>
  );
}
