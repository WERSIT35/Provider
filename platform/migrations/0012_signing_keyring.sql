-- 0012_signing_keyring.sql — signing key registry + per-row Ed25519 ledger signatures.
--
-- signing_keys: the PUBLIC half of every key that ever signed an export or a ledger row
-- (src/lib/security/signing-keyring.ts). Private keys are never stored. Rotation = a new
-- EXPORT_SIGNING_KEY and a restart: the app registers it as active and marks the
-- previous key retired; retired keys stay here for good, so old signatures always verify.
-- The key material is write-once: only status / retired_at / expires_at may change, and
-- no row may be deleted.

CREATE TABLE signing_keys (
  key_id          text PRIMARY KEY,
  alg             text NOT NULL CHECK (alg = 'Ed25519'),
  public_key_pem  text NOT NULL,
  status          text NOT NULL CHECK (status IN ('active', 'retired')),
  created_at      timestamptz NOT NULL,
  retired_at      timestamptz,
  expires_at      timestamptz
);

CREATE OR REPLACE FUNCTION signing_keys_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signing_keys rows are permanent (key %)', OLD.key_id;
  END IF;
  IF NEW.key_id <> OLD.key_id OR NEW.alg <> OLD.alg OR NEW.public_key_pem <> OLD.public_key_pem OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'signing key material is write-once (key %)', OLD.key_id;
  END IF;
  IF OLD.status = 'retired' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'a retired signing key cannot be re-activated (key %)', OLD.key_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_signing_keys_guard BEFORE UPDATE OR DELETE ON signing_keys
  FOR EACH ROW EXECUTE FUNCTION signing_keys_guard();

-- Per-row signature over `vault20k.ledger.v1|<table>|<seq>|<chain_hash>`, made at insert.
-- Outside the hashed payload, so the hash chain is unchanged; NULL on rows from before.
ALTER TABLE rounds ADD COLUMN signature text;
ALTER TABLE rounds ADD COLUMN signing_key_id text;
ALTER TABLE audit_records ADD COLUMN signature text;
ALTER TABLE audit_records ADD COLUMN signing_key_id text;
