import { Navigate, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function RequireAuth() {
  const { session } = useAuth();
  const location = useLocation();
  const context = useOutletContext();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet context={context} />;
}
