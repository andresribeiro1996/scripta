export class GoogleSignInStateMismatchError extends Error {}

export function authorizationCodeFromGoogleRedirect(resultUrl: string, expectedState: string): string {
  const url = new URL(resultUrl);
  if (url.searchParams.get("state") !== expectedState) {
    throw new GoogleSignInStateMismatchError("Google sign-in redirect did not match the request this app started.");
  }

  const code = url.searchParams.get("code");
  if (!code) throw new Error("Google sign-in did not return an authorization code.");
  return code;
}
