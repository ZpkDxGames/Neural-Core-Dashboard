-- Additive only. The administrator owns the transaction and checksum ledger.
-- The legacy v1 tables and grants are unchanged. No server auto-migrates.
CREATE TABLE vault_principals (
  principal_id uuid PRIMARY KEY,
  owner_id text NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 120),
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK(kind IN ('owner','agent')),
  role text NOT NULL CHECK(role IN ('viewer','contributor','maintainer','owner')),
  scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 16),
  token_hash char(64) NOT NULL UNIQUE,
  disabled_at timestamptz,
  CHECK((kind='owner') = (role='owner')),
  UNIQUE(owner_id,principal_id)
);
CREATE TABLE vault_notes (
  note_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  canonical_path text NOT NULL,
  current_revision integer NOT NULL DEFAULT 0 CHECK(current_revision>=0),
  published_revision integer NOT NULL DEFAULT 0 CHECK(published_revision>=0 AND published_revision<=current_revision),
  published_hash char(64),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  note_type text NOT NULL,
  body_hash char(64) NOT NULL,
  trust text NOT NULL DEFAULT 'proposed' CHECK(trust IN ('proposed','verified','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  consolidated_into uuid REFERENCES vault_notes(note_id),
  UNIQUE(owner_id,note_id), UNIQUE(owner_id,canonical_path)
);
CREATE INDEX vault_notes_page ON vault_notes(owner_id,note_id) WHERE deleted_at IS NULL AND published_revision>0;
CREATE INDEX vault_notes_duplicates ON vault_notes(owner_id,body_hash) WHERE deleted_at IS NULL;
CREATE TABLE vault_proposals (
  proposal_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  note_id uuid,
  principal_id uuid NOT NULL REFERENCES vault_principals(principal_id),
  base_revision integer NOT NULL CHECK(base_revision>=0),
  payload jsonb NOT NULL CHECK(octet_length(payload::text)<=240000),
  payload_hash char(64) NOT NULL,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
  state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','accepted','rejected','conflict')),
  duplicate_of uuid,
  expected_file_hash char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE(owner_id,principal_id,idempotency_key)
);
CREATE INDEX vault_proposals_page ON vault_proposals(owner_id,state,created_at,proposal_id);
-- Only a separately authenticated owner step-up service / admin may INSERT grants.
CREATE TABLE vault_review_grants (
  proof_hash char(64) PRIMARY KEY,
  owner_id text NOT NULL,
  principal_id uuid NOT NULL REFERENCES vault_principals(principal_id),
  subject_id text NOT NULL,
  expected_revision integer NOT NULL CHECK(expected_revision>=0),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE vault_revisions (
  owner_id text NOT NULL,
  note_id uuid NOT NULL REFERENCES vault_notes(note_id),
  revision integer NOT NULL CHECK(revision>0),
  base_revision integer NOT NULL,
  content_hash char(64) NOT NULL,
  markdown text NOT NULL CHECK(octet_length(markdown)<=256000),
  payload jsonb NOT NULL,
  principal_id uuid NOT NULL REFERENCES vault_principals(principal_id),
  proposal_id uuid NOT NULL REFERENCES vault_proposals(proposal_id),
  verified_by uuid REFERENCES vault_principals(principal_id),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(note_id,revision),
  CHECK((verified_by IS NULL)=(verified_at IS NULL))
);
CREATE TABLE vault_evidence (
  owner_id text NOT NULL,
  note_id uuid NOT NULL,
  revision integer NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 31),
  source_kind text NOT NULL CHECK(source_kind IN ('conversation','manual')),
  conversation_id text,
  message_id text,
  manual_reason text,
  FOREIGN KEY(note_id,revision) REFERENCES vault_revisions(note_id,revision),
  FOREIGN KEY(conversation_id,message_id) REFERENCES messages(conversation_id,message_id) ON DELETE CASCADE,
  CHECK((source_kind='conversation' AND conversation_id IS NOT NULL AND message_id IS NOT NULL AND manual_reason IS NULL)
     OR (source_kind='manual' AND conversation_id IS NULL AND message_id IS NULL AND length(manual_reason) BETWEEN 1 AND 500)),
  PRIMARY KEY(note_id,revision,ordinal)
);
CREATE INDEX vault_evidence_source ON vault_evidence(conversation_id,message_id);
CREATE TABLE vault_relations (
  owner_id text NOT NULL,
  source_id uuid NOT NULL REFERENCES vault_notes(note_id),
  source_revision integer NOT NULL,
  target_id uuid NOT NULL REFERENCES vault_notes(note_id),
  relation_type text NOT NULL CHECK(relation_type IN ('related','supports','contradicts','derived-from','link','supersedes')),
  evidence_ordinal integer NOT NULL,
  confidence real CHECK(confidence BETWEEN 0 AND 1),
  FOREIGN KEY(source_id,source_revision,evidence_ordinal) REFERENCES vault_evidence(note_id,revision,ordinal) ON DELETE CASCADE,
  CHECK(source_id<>target_id),
  PRIMARY KEY(source_id,source_revision,target_id,relation_type)
);
CREATE INDEX vault_relations_incoming ON vault_relations(owner_id,target_id);
CREATE TABLE vault_outbox (
  event_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  note_id uuid NOT NULL REFERENCES vault_notes(note_id),
  revision integer NOT NULL,
  operation text NOT NULL CHECK(operation IN ('publish','delete')),
  expected_hash char(64),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','committed','failed','conflict','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  committed_at timestamptz,
  UNIQUE(note_id,revision,operation)
);
CREATE INDEX vault_outbox_ready ON vault_outbox(next_attempt_at,event_id) WHERE state='pending';
CREATE TABLE vault_external_edits (
  edit_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  note_id uuid,
  file_name text NOT NULL CHECK(length(file_name)<=160),
  observed_hash char(64) NOT NULL,
  code text NOT NULL,
  proposal_id uuid REFERENCES vault_proposals(proposal_id),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(owner_id,file_name,observed_hash,code)
);
CREATE TABLE vault_search_documents (
  owner_id text NOT NULL,
  note_id uuid PRIMARY KEY REFERENCES vault_notes(note_id),
  revision integer NOT NULL,
  document tsvector NOT NULL
);
CREATE INDEX vault_search_fts ON vault_search_documents USING gin(document);
CREATE INDEX vault_search_owner ON vault_search_documents(owner_id,note_id);
CREATE TABLE vault_actions (
  action_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  principal_id uuid,
  action text NOT NULL,
  target_id text NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vault_actions_page ON vault_actions(owner_id,created_at,action_id);
-- Deleting a legacy source also withdraws its derived notes and queues file deletion.
-- Revision history remains private for operator-controlled retention; no read API exposes it.
CREATE FUNCTION vault_withdraw_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vault_notes SET deleted_at=COALESCE(deleted_at,now()),trust='rejected',updated_at=now()
    WHERE note_id=OLD.note_id AND deleted_at IS NULL;
  DELETE FROM vault_search_documents WHERE note_id=OLD.note_id;
  UPDATE vault_outbox SET state='cancelled' WHERE note_id=OLD.note_id AND operation='publish' AND state='pending';
  INSERT INTO vault_outbox(event_id,owner_id,note_id,revision,operation)
    SELECT gen_random_uuid(),owner_id,note_id,current_revision,'delete' FROM vault_notes WHERE note_id=OLD.note_id
    ON CONFLICT(note_id,revision,operation) DO NOTHING;
  RETURN OLD;
END $$;
CREATE TRIGGER vault_source_deleted AFTER DELETE ON vault_evidence FOR EACH ROW EXECUTE FUNCTION vault_withdraw_source();
REVOKE ALL ON vault_principals,vault_notes,vault_proposals,vault_review_grants,vault_revisions,vault_evidence,vault_relations,vault_outbox,vault_external_edits,vault_search_documents,vault_actions FROM PUBLIC;
GRANT SELECT ON vault_principals TO neuralcore_api;
GRANT SELECT,UPDATE ON vault_review_grants TO neuralcore_api;
GRANT SELECT,INSERT ON vault_revisions,vault_evidence,vault_relations,vault_actions TO neuralcore_api;
GRANT SELECT,INSERT,UPDATE ON vault_notes,vault_proposals,vault_outbox,vault_external_edits TO neuralcore_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON vault_search_documents TO neuralcore_api;
-- No INSERT on identity / owner-proof tables and no UPDATE or DELETE on revisions.
