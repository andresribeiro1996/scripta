import { useAuth } from "../auth/AuthContext";
import { DashboardLayout } from "./DashboardLayout";
import { PublicLayout } from "./PublicLayout";

export function SessionLayout() {
  const { session } = useAuth();
  return session?.user.username ? <DashboardLayout /> : <PublicLayout signedIn={Boolean(session)} />;
}
