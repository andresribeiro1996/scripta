import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { AuthProvider, useAuth } from "./auth/AuthContext.tsx";
import { ConfirmProvider } from "./components/ConfirmDialog.tsx";
import { ToastProvider } from "./components/Toaster.tsx";
import "./index.css";

function AccountApp() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useMemo(() => new QueryClient(), [userId]);
  return <QueryClientProvider key={userId ?? "public"} client={queryClient}>
    <ToastProvider><ConfirmProvider><App /></ConfirmProvider></ToastProvider>
  </QueryClientProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider><AccountApp /></AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
