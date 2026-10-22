-- Source-only additive migration. Administrator applies explicitly to a disposable/staging DB.
-- No modification of 001/002/003; no runtime or automatic migration entry point.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='neuralcore_issuer') THEN CREATE ROLE neuralcore_issuer NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='neuralcore_private_admin') THEN CREATE ROLE neuralcore_private_admin NOLOGIN; END IF;
END $$;
ALTER TABLE vault_principals ADD COLUMN permission_epoch integer NOT NULL DEFAULT 1 CHECK(permission_epoch>0);
ALTER TABLE vault_principals ADD COLUMN credential_expires_at timestamptz;
ALTER TABLE vault_principals ADD COLUMN synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE vault_principals ADD CONSTRAINT vault_synthetic_scope CHECK(NOT synthetic OR
 (kind='agent' AND role<>'owner' AND credential_expires_at IS NOT NULL AND
 scopes <@ ARRAY['read','propose','type:fact','type:project','type:decision','type:reference']::text[] AND
 scopes && ARRAY['type:fact','type:project','type:decision','type:reference']::text[] AND
 (role<>'viewer' OR NOT ('propose'=ANY(scopes)))));
CREATE UNIQUE INDEX vault_one_synthetic_agent ON vault_principals(owner_id) WHERE synthetic AND disabled_at IS NULL;
CREATE TABLE vault_owner_identities(
 identity_hash char(64) PRIMARY KEY CHECK(identity_hash ~ '^[0-9a-f]{64}$'),
 principal_id uuid NOT NULL REFERENCES vault_principals(principal_id),
 UNIQUE(principal_id)
);
CREATE TABLE vault_private_sessions(
 session_ref_hash char(64) PRIMARY KEY CHECK(session_ref_hash ~ '^[0-9a-f]{64}$'),
 principal_id uuid NOT NULL REFERENCES vault_principals(principal_id),
 identity_hash char(64) NOT NULL REFERENCES vault_owner_identities(identity_hash),
 expires_at timestamptz NOT NULL,
 consent_epoch integer NOT NULL DEFAULT 1 CHECK(consent_epoch>0),
 consented boolean NOT NULL DEFAULT false,
 revoked_at timestamptz
);
CREATE TABLE vault_service_replays(
 jti_hash char(64) PRIMARY KEY CHECK(jti_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL
);
CREATE INDEX vault_service_replay_expiry ON vault_service_replays(expires_at);
CREATE TABLE vault_private_quota(
 principal_id uuid NOT NULL REFERENCES vault_principals(principal_id),
 minute bigint NOT NULL,
 count integer NOT NULL CHECK(count BETWEEN 1 AND 60),
 PRIMARY KEY(principal_id,minute)
);
CREATE TABLE vault_owner_challenges(
 challenge_id uuid PRIMARY KEY,
 owner_id text NOT NULL,
 principal_id uuid NOT NULL REFERENCES vault_principals(principal_id),
 session_ref_hash char(64) NOT NULL REFERENCES vault_private_sessions(session_ref_hash),
 identity_hash char(64) NOT NULL,
 action text NOT NULL CHECK(action IN ('verify','publish-unverified','reject','delete','consolidate','repair','provision-agent','rotate-agent','revoke-agent')),
 subject_id text NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 160),
 expected_revision integer NOT NULL CHECK(expected_revision>=0),
 intent_hash char(64) NOT NULL CHECK(intent_hash ~ '^[0-9a-f]{64}$'),
 principal_epoch integer NOT NULL CHECK(principal_epoch>0),
 consent_epoch integer NOT NULL CHECK(consent_epoch>0),
 intent jsonb NOT NULL CHECK(octet_length(intent::text)<=240000),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL CHECK(expires_at<=created_at+interval '120 seconds'),
 fresh_at timestamptz,
 consumed_at timestamptz,
 receipt jsonb,
 CHECK((consumed_at IS NULL)=(receipt IS NULL))
);
CREATE INDEX vault_owner_challenges_active ON vault_owner_challenges(session_ref_hash,expires_at) WHERE consumed_at IS NULL;
-- Historic unbound grants are invalidated, retained for audit only.
UPDATE vault_review_grants SET used_at=COALESCE(used_at,now());
ALTER TABLE vault_review_grants ADD COLUMN action text;
ALTER TABLE vault_review_grants ADD COLUMN intent_hash char(64);
ALTER TABLE vault_review_grants ADD COLUMN session_ref_hash char(64);
ALTER TABLE vault_review_grants ADD COLUMN identity_hash char(64);
ALTER TABLE vault_review_grants ADD COLUMN principal_epoch integer;
ALTER TABLE vault_review_grants ADD COLUMN consent_epoch integer;
ALTER TABLE vault_review_grants ADD COLUMN issued_at timestamptz;
ALTER TABLE vault_review_grants ADD CONSTRAINT vault_bound_grant CHECK(
 (action IS NULL AND used_at IS NOT NULL) OR
 (action IN ('verify','publish-unverified','reject','delete','consolidate','repair','provision-agent','rotate-agent','revoke-agent')
 AND intent_hash ~ '^[0-9a-f]{64}$' AND session_ref_hash ~ '^[0-9a-f]{64}$' AND identity_hash ~ '^[0-9a-f]{64}$'
 AND principal_epoch>0 AND consent_epoch>0 AND issued_at IS NOT NULL AND expires_at>issued_at AND expires_at<=issued_at+interval '60 seconds'
 AND intent_hash IS NOT NULL AND session_ref_hash IS NOT NULL AND identity_hash IS NOT NULL AND principal_epoch IS NOT NULL AND consent_epoch IS NOT NULL));

-- Runtime may consume grants, but can never insert them. Issuer has an action-specific function.
CREATE FUNCTION vault_issue_bound_grant(challenge uuid, digest text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.vault_owner_challenges; p public.vault_principals; s public.vault_private_sessions;
BEGIN
 IF digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_GRANT'; END IF;
 SELECT * INTO c FROM public.vault_owner_challenges WHERE challenge_id=challenge FOR UPDATE;
 IF NOT FOUND OR c.consumed_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.fresh_at IS NULL
 OR c.fresh_at<clock_timestamp()-interval '120 seconds' OR c.fresh_at>clock_timestamp()+interval '5 seconds' THEN RAISE EXCEPTION 'FRESH_OWNER_REQUIRED'; END IF;
 SELECT * INTO s FROM public.vault_private_sessions WHERE session_ref_hash=c.session_ref_hash FOR SHARE;
 SELECT * INTO p FROM public.vault_principals WHERE principal_id=c.principal_id FOR SHARE;
 IF p.kind<>'owner' OR p.role<>'owner' OR p.disabled_at IS NOT NULL OR p.permission_epoch<>c.principal_epoch
 OR s.revoked_at IS NOT NULL OR NOT s.consented OR s.consent_epoch<>c.consent_epoch OR s.expires_at<=clock_timestamp()
 OR s.identity_hash<>c.identity_hash OR s.principal_id<>p.principal_id OR p.owner_id<>c.owner_id THEN RAISE EXCEPTION 'STALE_AUTHORIZATION'; END IF;
 INSERT INTO public.vault_review_grants(proof_hash,owner_id,principal_id,subject_id,expected_revision,expires_at,action,intent_hash,session_ref_hash,identity_hash,principal_epoch,consent_epoch,issued_at)
 VALUES(digest,c.owner_id,c.principal_id,c.subject_id,c.expected_revision,LEAST(c.expires_at,s.expires_at,clock_timestamp()+interval '60 seconds'),c.action,c.intent_hash,c.session_ref_hash,c.identity_hash,c.principal_epoch,c.consent_epoch,clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION vault_issue_bound_grant(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vault_issue_bound_grant(uuid,text) TO neuralcore_issuer;

-- Restricted administration function cannot create an owner, unlimited credentials, or review scopes.
CREATE FUNCTION vault_apply_synthetic_agent(operation text, owner text, subject uuid, display text, agent_role text, agent_scopes text[], token_digest text, expiry timestamptz, grant_digest text, session_hash text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE g public.vault_review_grants; c public.vault_owner_challenges; p public.vault_principals; s public.vault_private_sessions;
BEGIN
 SELECT * INTO g FROM public.vault_review_grants WHERE proof_hash=grant_digest FOR UPDATE;
 IF NOT FOUND OR g.used_at IS NOT NULL OR g.expires_at<=clock_timestamp() OR g.action<>operation OR g.owner_id<>owner OR g.subject_id<>subject::text OR g.session_ref_hash<>session_hash THEN RAISE EXCEPTION 'OWNER_PROOF_INVALID'; END IF;
 SELECT * INTO s FROM public.vault_private_sessions WHERE session_ref_hash=session_hash FOR SHARE;
 SELECT * INTO p FROM public.vault_principals WHERE principal_id=g.principal_id FOR SHARE;
 IF s.revoked_at IS NOT NULL OR NOT s.consented OR s.expires_at<=clock_timestamp() OR s.consent_epoch<>g.consent_epoch OR s.identity_hash<>g.identity_hash OR s.principal_id<>g.principal_id OR p.kind<>'owner' OR p.disabled_at IS NOT NULL OR p.permission_epoch<>g.principal_epoch THEN RAISE EXCEPTION 'STALE_AUTHORIZATION'; END IF;
 SELECT * INTO c FROM public.vault_owner_challenges WHERE session_ref_hash=session_hash AND subject_id=subject::text AND action=operation AND intent_hash=g.intent_hash AND consumed_at IS NULL AND expires_at>clock_timestamp() AND fresh_at IS NOT NULL ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_PROOF_INVALID'; END IF;
 IF operation='provision-agent' AND (c.intent->>'displayName'<>display OR c.intent->>'role'<>agent_role OR ARRAY(SELECT jsonb_array_elements_text(c.intent->'scopes'))<>agent_scopes OR expiry>clock_timestamp()+((c.intent->>'expiresInSeconds')::integer*interval '1 second')) THEN RAISE EXCEPTION 'STALE_INTENT'; END IF;
 IF operation IN ('rotate-agent','revoke-agent') AND NOT EXISTS(SELECT 1 FROM public.vault_principals WHERE principal_id=subject AND permission_epoch=g.expected_revision AND disabled_at IS NULL) THEN RAISE EXCEPTION 'STALE_INTENT'; END IF;
 UPDATE public.vault_review_grants SET used_at=clock_timestamp() WHERE proof_hash=grant_digest;
 IF operation NOT IN ('provision-agent','rotate-agent','revoke-agent') THEN RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
 IF operation='provision-agent' THEN
  IF agent_role NOT IN ('viewer','contributor','maintainer') OR cardinality(agent_scopes) NOT BETWEEN 1 AND 16
   OR NOT (agent_scopes <@ ARRAY['read','propose','type:fact','type:project','type:decision','type:reference']::text[])
   OR NOT (agent_scopes && ARRAY['type:fact','type:project','type:decision','type:reference']::text[])
   OR (agent_role='viewer' AND 'propose'=ANY(agent_scopes)) OR token_digest !~ '^[0-9a-f]{64}$'
   OR expiry<=clock_timestamp() OR expiry>clock_timestamp()+interval '1 hour' THEN RAISE EXCEPTION 'INVALID_AGENT_GRANT'; END IF;
  INSERT INTO public.vault_principals(principal_id,owner_id,display_name,kind,role,scopes,token_hash,credential_expires_at,synthetic)
   VALUES(subject,owner,display,'agent',agent_role,agent_scopes,token_digest,expiry,true);
 ELSE
  PERFORM 1 FROM public.vault_principals WHERE principal_id=subject AND owner_id=owner AND synthetic AND kind='agent' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_NOT_FOUND'; END IF;
  IF operation='rotate-agent' AND (token_digest !~ '^[0-9a-f]{64}$' OR expiry<=clock_timestamp() OR expiry>clock_timestamp()+interval '1 hour') THEN RAISE EXCEPTION 'INVALID_AGENT_GRANT'; END IF;
  UPDATE public.vault_principals SET permission_epoch=permission_epoch+1,
   disabled_at=CASE WHEN operation='revoke-agent' THEN clock_timestamp() ELSE disabled_at END,
   token_hash=CASE WHEN operation='rotate-agent' THEN token_digest ELSE token_hash END,
   credential_expires_at=CASE WHEN operation='rotate-agent' THEN expiry ELSE credential_expires_at END
   WHERE principal_id=subject;
  UPDATE public.vault_review_grants SET used_at=COALESCE(used_at,clock_timestamp()) WHERE principal_id=subject;
 END IF;
END $$;
REVOKE ALL ON FUNCTION vault_apply_synthetic_agent(text,text,uuid,text,text,text[],text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vault_apply_synthetic_agent(text,text,uuid,text,text,text[],text,timestamptz,text,text) TO neuralcore_private_admin;

REVOKE ALL ON vault_owner_identities,vault_private_sessions,vault_service_replays,vault_private_quota,vault_owner_challenges FROM PUBLIC;
GRANT SELECT ON vault_owner_identities,vault_private_sessions,vault_owner_challenges TO neuralcore_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON vault_service_replays,vault_private_quota TO neuralcore_api;
GRANT SELECT ON vault_principals,vault_proposals,vault_private_sessions,vault_owner_identities,vault_owner_challenges TO neuralcore_issuer;
GRANT INSERT,UPDATE ON vault_private_sessions,vault_owner_challenges TO neuralcore_issuer;
-- A separately authenticated issuer may finish a review transaction using API DML.
GRANT neuralcore_api TO neuralcore_issuer;
GRANT neuralcore_private_admin TO neuralcore_issuer;
-- Only the issuer login receives this membership; never the engine API login.
-- Row locks without granting identity/consent UPDATE privileges to the API.
CREATE FUNCTION vault_lock_authorization(principal uuid, session_hash text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.vault_principals WHERE principal_id=principal FOR SHARE;
 IF session_hash IS NOT NULL THEN PERFORM 1 FROM public.vault_private_sessions WHERE session_ref_hash=session_hash FOR SHARE; END IF;
END $$;
REVOKE ALL ON FUNCTION vault_lock_authorization(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vault_lock_authorization(uuid,text) TO neuralcore_api;

ALTER TABLE vault_review_grants ADD CONSTRAINT vault_no_active_legacy_grants CHECK(action IS NOT NULL OR used_at IS NOT NULL);
CREATE FUNCTION vault_bump_permission_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF (NEW.role,NEW.scopes,NEW.token_hash,NEW.disabled_at,NEW.credential_expires_at) IS DISTINCT FROM (OLD.role,OLD.scopes,OLD.token_hash,OLD.disabled_at,OLD.credential_expires_at) THEN
  NEW.permission_epoch=GREATEST(OLD.permission_epoch+1,NEW.permission_epoch);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION vault_bump_permission_epoch() FROM PUBLIC;
CREATE TRIGGER vault_permission_change BEFORE UPDATE ON vault_principals FOR EACH ROW EXECUTE FUNCTION vault_bump_permission_epoch();
CREATE UNIQUE INDEX vault_agent_request_idempotency ON vault_owner_challenges(owner_id,(intent->>'idempotencyKey')) WHERE action='provision-agent';
-- Schema 003 granted table-wide UPDATE; 004 restricts consumption to used_at only.
REVOKE UPDATE ON vault_review_grants FROM neuralcore_api;
GRANT UPDATE(used_at) ON vault_review_grants TO neuralcore_api;
