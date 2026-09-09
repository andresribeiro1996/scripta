export async function uploadWithTokenRecovery<T extends { status: number }>(
  token: string,
  upload: (accessToken: string) => Promise<T>,
  recoverAccessToken: (rejectedToken: string) => Promise<string | null>,
): Promise<T> {
  const response = await upload(token);
  if (response.status !== 401) return response;
  const retryToken = await recoverAccessToken(token);
  return retryToken ? upload(retryToken) : response;
}
