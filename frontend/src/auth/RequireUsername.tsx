import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** Nested inside <RequireAuth> (see App.tsx): by the time this runs, a
 *  session is already guaranteed to exist. This only adds the
 *  "has the account finished setup" check — currently just "has a
 *  username" — so a Google sign-in that hasn't picked one yet lands on
 *  /choose-username instead of the dashboard. A password-signup account
 *  never hits this, since a username is required at signup time. */
export function RequireUsername() {
  const { session } = useAuth();

  if (session && !session.user.username) {
    return <Navigate to="/choose-username" replace />;
  }

  return <Outlet />;
}
