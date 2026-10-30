import { Redirect, useGlobalSearchParams, usePathname } from "expo-router";
import { useAuth } from "../../../../core/auth";
import { pathWithQuery } from "../../../../features/auth/navigation";
import CharactersRoute from "../../../(app)/(home,arena,library,search,you)/work/[id]/characters";

export default function PublicCharactersRoute() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const { ready, user } = useAuth();
  if (!ready) return null;
  if (!user) return <Redirect href={{ pathname: "/login", params: { returnTo: pathWithQuery(pathname, params) } }} />;
  return <CharactersRoute />;
}
