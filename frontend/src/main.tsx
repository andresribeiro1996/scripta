import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AccountApp } from "./AccountApp.tsx";
import { AuthProvider } from "./auth/AuthContext.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider><AccountApp /></AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
