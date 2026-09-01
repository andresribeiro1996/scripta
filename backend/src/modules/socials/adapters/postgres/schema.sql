-- The Postgres counterpart of adapters/sqlite/schema.sql.
--
-- access_token_enc and refresh_token_enc are CIPHERTEXT (see
-- ../../crypto.ts), never plaintext — which also means a database dump is
-- useless for these without SOCIALS_ENCRYPTION_KEY, and that losing the
-- key makes every row here permanently undecryptable.
CREATE TABLE IF NOT EXISTS social_connections (
  user_id              TEXT NOT NULL,
  provider             TEXT NOT NULL,
  handle               TEXT,
  provider_account_id  TEXT,
  access_token_enc     TEXT NOT NULL,
  refresh_token_enc    TEXT,
  expires_at           TEXT,
  connected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);
