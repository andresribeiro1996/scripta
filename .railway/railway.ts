import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const scriptaVolume = volume("scripta-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "iad",
    sizeMB: 5000,
  });

  const scripta = service("scripta", {
    source: github("andresribeiro1996/scripta", { branch: "production", checkSuites: true, rootDirectory: "/" }),
    build: {
      builder: "RAILPACK",
      buildCommand: "sh backend/scripts/install-litestream.sh && npm run build --workspace @scripta/shared && npm run build --workspace backend",
    },
    start: "sh backend/scripts/start-with-litestream.sh",
    healthcheck: "/health",
    healthcheckTimeout: 300,
    deploy: { restartPolicyMaxRetries: 5 },
    replicas: { iad: 1 },
    domains: [{ domain: "api.atmyshelf.com", port: 3000 }],
    volumeMounts: { "/data": scriptaVolume },
    env: {
      ADMIN_USER_ID: preserve(),
      ALERT_EMAIL: preserve(),
      ARENA_DB_PATH: preserve(),
      AUTH_DB_PATH: preserve(),
      AUTH_EMAIL_FROM: preserve(),
      AVATAR_STORAGE_PATH: preserve(),
      COMMUNITY_DB_PATH: preserve(),
      COVERS_DB_PATH: preserve(),
      COVERS_STORAGE_PATH: preserve(),
      FRONTEND_URL: preserve(),
      GALLERY_DB_PATH: preserve(),
      GALLERY_STORAGE_PATH: preserve(),
      GOOGLE_CALLBACK_URL: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      ISBNDB_API_KEY: preserve(),
      JWT_ACCESS_SECRET: preserve(),
      JWT_REFRESH_SECRET: preserve(),
      LIBRARY_DB_PATH: preserve(),
      MOBILE_OAUTH_REDIRECT_ALLOWLIST: preserve(),
      MURALS_DB_PATH: preserve(),
      NODE_ENV: preserve(),
      OAUTH_SUCCESS_REDIRECT_URL: preserve(),
      PORT: preserve(),
      PUBLIC_API_URL: preserve(),
      QUIZZES_DB_PATH: preserve(),
      R2_ACCESS_KEY_ID: preserve(),
      R2_BACKUPS_BUCKET: preserve(),
      R2_ENDPOINT: preserve(),
      R2_IMAGES_BUCKET: preserve(),
      R2_IMAGES_PUBLIC_URL: preserve(),
      R2_SECRET_ACCESS_KEY: preserve(),
      RESEND_API_KEY: preserve(),
      SOCIALS_DB_PATH: preserve(),
      SOCIALS_SUCCESS_REDIRECT_URL: preserve(),
      TIERLISTS_DB_PATH: preserve(),
    },
  });

  return project("Atmyshelf", {
    resources: [scripta, scriptaVolume],
  });
});
