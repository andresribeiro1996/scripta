import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

export function OfflineBanner() {
  const t = useT();
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const ref = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    const banner = ref.current;
    const host = banner?.parentElement;
    if (!banner || !host) return;
    const publish = () => host.style.setProperty("--offline-h", `${banner.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      host.style.removeProperty("--offline-h");
    };
  }, [online]);
  if (online) return null;
  return (
    <div ref={ref} role="status" className="sticky top-(--app-top) z-30 bg-(--color-accent-soft) px-4 py-2 text-center text-sm font-medium text-(--color-accent)">
      {t("shell.offline")}
    </div>
  );
}
