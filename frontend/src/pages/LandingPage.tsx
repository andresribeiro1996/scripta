import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { landingDestination } from "../lib/landing";
import { LandingNav } from "../components/landing/LandingNav";
import { LandingHero } from "../components/landing/LandingHero";
import { HowItWorks } from "../components/landing/HowItWorks";
import { MuralShowcase } from "../components/landing/MuralShowcase";
import { ArenaShowcase } from "../components/landing/ArenaShowcase";
import { GetStarted } from "../components/landing/GetStarted";
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
        <HowItWorks />
        <MuralShowcase />
        <ArenaShowcase />
        <GetStarted />
      </main>
      <LandingFooter />
    </div>
  );
}
