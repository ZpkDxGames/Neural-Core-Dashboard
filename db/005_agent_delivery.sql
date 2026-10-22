-- Source-only. Explicit administrator migration on disposable test databases only.
-- 001--004 are immutable. The API role has no access to encrypted custody material.
CREATE TABLE vault_agent_deliveries (
 delivery_id uuid PRIMARY KEY REFERENCES vault_owner_challenges(challenge_id),
 generation bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 subject_id uuid NOT NULL,
 owner_id text NOT NULL,
 credential_hash char(64) NOT NULL CHECK(credential_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,
 sealed jsonb,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 last_outcome text NOT NULL DEFAULT 'READY' CHECK(last_outcome IN ('READY','SINK_UNAVAILABLE','ACTIVATION_UNCONFIRMED','DELIVERED','CANCELLED','KEY_UNAVAILABLE')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at <= created_at + interval '1 hour'),
 CHECK((state='pending')=(sealed IS NOT NULL)),
 CHECK(sealed IS NULL OR (jsonb_typeof(sealed)='object' AND octet_length(sealed::text)<=1024))
);
CREATE UNIQUE INDEX vault_one_pending_agent_delivery ON vault_agent_deliveries(subject_id) WHERE state='pending';
CREATE INDEX vault_agent_delivery_expiry ON vault_agent_deliveries(expires_at) WHERE state='pending';
REVOKE ALL ON vault_agent_deliveries FROM PUBLIC, neuralcore_api, neuralcore_private_admin;
GRANT SELECT, INSERT ON vault_agent_deliveries TO neuralcore_issuer;
GRANT UPDATE(sealed,state,attempts,last_outcome) ON vault_agent_deliveries TO neuralcore_issuer;

CREATE OR REPLACE FUNCTION vault_apply_synthetic_agent(operation text, owner text, subject uuid, display text, agent_role text, agent_scopes text[], token_digest text, expiry timestamptz, grant_digest text, session_hash text)
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
 -- The reviewed owner intent also bounds rotation lifetime at the SQL authority boundary.
 IF operation='rotate-agent' AND (c.intent->>'expiresInSeconds' IS NULL
   OR (c.intent->>'expiresInSeconds')::integer NOT BETWEEN 1 AND 3600
   OR expiry>clock_timestamp()+((c.intent->>'expiresInSeconds')::integer*interval '1 second'))
 THEN RAISE EXCEPTION 'STALE_INTENT'; END IF;
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
