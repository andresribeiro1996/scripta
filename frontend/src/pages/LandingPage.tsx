import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { landingDestination } from "../lib/landing";
import { LandingNav } from "../components/landing/LandingNav";
import { LandingHero } from "../components/landing/LandingHero";
import { FeatureGrid } from "../components/landing/FeatureGrid";
import { ReaderCards } from "../components/landing/ReaderCards";
import { MuralShowcase } from "../components/landing/MuralShowcase";
import { ArenaShowcase } from "../components/landing/ArenaShowcase";
import { TierSort } from "../components/landing/TierSort";
import { GetApp } from "../components/landing/GetApp";
import { LandingFooter } from "../components/landing/LandingFooter";

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
        <ReaderCards />
        <MuralShowcase />
        <ArenaShowcase />
        <TierSort />
        <GetApp />
      </main>
      <LandingFooter />
    </div>
  );
}
