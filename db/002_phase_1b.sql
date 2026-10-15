-- Neural Core Phase 1b. Run by a dedicated migration administrator, NEVER by neuralcore_api.
-- The migrator owns the transaction and checksum ledger. This file must not include BEGIN/COMMIT.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT 'owner';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source_record_id text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS conversations_owner_page_idx ON conversations(owner_id, received_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS conversations_owner_source_page_idx ON conversations(owner_id,source_id,received_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_source_record_idx ON conversations(owner_id, source_id, source_record_id) WHERE source_record_id IS NOT NULL;

ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT 'owner';
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS memory_nodes_owner_page_idx ON memory_nodes(owner_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS memory_evidence_message_idx ON memory_evidence(conversation_id,message_id);
-- NOT VALID accepts preexisting rows without deleting data; VALIDATE fails safely if evidence was forged.
ALTER TABLE memory_evidence ADD CONSTRAINT memory_evidence_real_message_fk
  FOREIGN KEY(conversation_id,message_id) REFERENCES messages(conversation_id,message_id)
  ON DELETE CASCADE NOT VALID;
ALTER TABLE memory_evidence VALIDATE CONSTRAINT memory_evidence_real_message_fk;

CREATE TABLE IF NOT EXISTS import_requests (
  owner_id text NOT NULL,
  idempotency_key text NOT NULL,
  payload_sha256 char(64) NOT NULL,
  imported_count integer NOT NULL,
  message_count integer NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS imports_recent_idx ON import_requests(owner_id,committed_at DESC);
CREATE TABLE IF NOT EXISTS deleted_conversations (
  owner_id text NOT NULL,
  conversation_id text NOT NULL,
  source_id text NOT NULL REFERENCES sources(id),
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,conversation_id)
);
-- DB-level constraints protect against accidental invalid revisions and invalid hash sizes.
ALTER TABLE conversations ADD CONSTRAINT conversations_revision_positive CHECK (revision > 0);
ALTER TABLE memory_nodes ADD CONSTRAINT memory_nodes_revision_positive CHECK (revision > 0);

-- GRANT explicitly to the isolated API role. Nothing is granted to PUBLIC.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO neuralcore_api;
GRANT SELECT ON sources TO neuralcore_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON conversations,messages,memory_nodes,memory_edges,memory_evidence,import_requests,deleted_conversations TO neuralcore_api;
REVOKE ALL ON schema_migrations FROM neuralcore_api;
