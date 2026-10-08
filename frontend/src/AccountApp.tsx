import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { App } from "./App.tsx";
import { useAuth } from "./auth/AuthContext.tsx";
import { ConfirmProvider } from "./components/ConfirmDialog.tsx";
import { ToastProvider } from "./components/Toaster.tsx";
import { createWebLibrarySaver, LibrarySaverContext } from "./hooks/useLibrarySaver.ts";

export function AccountApp() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { queryClient, saver } = useMemo(() => {
    const client = new QueryClient();
    return { queryClient: client, saver: createWebLibrarySaver(client) };
  }, [userId]);
  const current = useRef(saver);
  useEffect(() => {
    if (current.current !== saver) {
      current.current.dispose();
      current.current = saver;
    }
  }, [saver]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saver.hasPending()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saver]);
  return <QueryClientProvider key={userId ?? "public"} client={queryClient}>
    <LibrarySaverContext.Provider value={saver}>
      <ToastProvider><ConfirmProvider><App /></ConfirmProvider></ToastProvider>
    </LibrarySaverContext.Provider>
  </QueryClientProvider>;
}
