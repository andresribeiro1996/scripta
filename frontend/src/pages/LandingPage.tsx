import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { landingDestination } from "../lib/landing";
import { LandingNav } from "../components/landing/LandingNav";
import { LandingHero } from "../components/landing/LandingHero";
import { LandingFooter } from "../components/landing/LandingFooter";

export function LandingPage() {
  const { session } = useAuth();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  const destination = landingDestination(session);
  if (destination) return <Navigate to={destination} replace />;
  return (
    <div className="relative isolate flex min-h-svh flex-col bg-(--color-bg) font-sans text-(--color-text) [&_:focus-visible]:outline-(--color-text)!">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse 340px 420px at 50% 46%, color-mix(in srgb, var(--color-text) 7%, transparent), transparent 75%), radial-gradient(ellipse at 50% 48%, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 65%)" }} />
      <LandingNav />
      <main className="flex flex-1 flex-col">
        <LandingHero />
      </main>
      <LandingFooter />
    </div>
  );
}
