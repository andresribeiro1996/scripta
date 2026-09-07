export const API_URL = (() => {
  const raw = process.env.EXPO_PUBLIC_API_URL;
  if (!raw) throw new Error("EXPO_PUBLIC_API_URL is not set — point it at the backend origin (e.g. http://192.168.1.160:3000)");
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    return raw.replace(/\/+$/, "");
  } catch {
    throw new Error(`EXPO_PUBLIC_API_URL is not a valid http(s) URL: ${raw}`);
  }
})();
