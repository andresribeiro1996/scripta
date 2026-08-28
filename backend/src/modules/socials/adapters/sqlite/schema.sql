-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as every other module (see
-- modules/library/adapters/sqlite/schema.sql). access_token_enc and
-- refresh_token_enc are ciphertext (see ../../crypto.ts), never plaintext.

CREATE TABLE IF NOT EXISTS social_connections (
  user_id              TEXT NOT NULL,
  provider             TEXT NOT NULL,
  handle               TEXT,
  provider_account_id  TEXT,
  access_token_enc     TEXT NOT NULL,
  refresh_token_enc    TEXT,
  expires_at           TEXT,
  connected_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, provider)
);
