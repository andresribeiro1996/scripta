import { useAuth } from "../auth/AuthContext";
import { DashboardLayout } from "./DashboardLayout";
import { PublicLayout } from "./PublicLayout";

export function SessionLayout() {
  const { session } = useAuth();
  return session ? <DashboardLayout /> : <PublicLayout signedIn={false} />;
}
