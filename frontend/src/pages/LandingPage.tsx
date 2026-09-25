import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { landingDestination } from "../lib/landing";
import { LandingNav } from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingFooter";
import { LandingHero } from "../components/landing/LandingHero";
import { FeatureGrid } from "../components/landing/FeatureGrid";
import { MuralShowcase } from "../components/landing/MuralShowcase";
import { ArenaShowcase } from "../components/landing/ArenaShowcase";
import { GetApp } from "../components/landing/GetApp";

export function LandingPage() {
  const { session } = useAuth();
  const destination = landingDestination(session);
  if (destination) return <Navigate to={destination} replace />;
  return (
    <div className="min-h-screen bg-(--color-bg) text-(--color-text)">
      <LandingNav />
      <main>
        <LandingHero />
        <FeatureGrid />
        <MuralShowcase />
        <ArenaShowcase />
        <GetApp />
      </main>
      <LandingFooter />
    </div>
  );
}
