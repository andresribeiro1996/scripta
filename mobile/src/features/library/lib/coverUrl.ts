export function coverUrlForApi(url: string, apiUrl: string): string {
  return url.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?=\/covers\/cached\/)/, apiUrl);
}
