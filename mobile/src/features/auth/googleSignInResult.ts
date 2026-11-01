import { t } from "../../i18n";

export class GoogleSignInStateMismatchError extends Error {}

export function authorizationCodeFromGoogleRedirect(resultUrl: string, expectedState: string): string {
  const url = new URL(resultUrl);
  if (url.searchParams.get("state") !== expectedState) {
    throw new GoogleSignInStateMismatchError(t("shell.googleSignInMismatch"));
  }

  const code = url.searchParams.get("code");
  if (!code) throw new Error(t("shell.googleSignInNoCode"));
  return code;
}
