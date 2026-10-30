import { DailyChapterCard } from "../components/dailyChapter/DailyChapterCard";
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { landingDestination } from "../lib/landing";
import { LandingNav } from "../components/landing/LandingNav";
import { LandingHero } from "../components/landing/LandingHero";
import { LandingFooter } from "../components/landing/LandingFooter";
import { publicPageBackground, publicPageClass } from "../components/landing/ui";

export function LandingPage() {
  const { session } = useAuth();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  const destination = landingDestination(session);
  if (destination) return <Navigate to={destination} replace />;
  return (
    <div className={publicPageClass}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={publicPageBackground} />
      <LandingNav />
      <main className="flex flex-1 flex-col">
        <LandingHero />
        <div className="mx-auto w-full max-w-3xl px-4 py-6"><DailyChapterCard /></div>
      </main>
      <LandingFooter />
    </div>
  );
}
