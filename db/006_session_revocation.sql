-- Explicit administrator migration only; applied migrations 001-005 are immutable.
-- A revoked family is a permanent tombstone through its original absolute expiry.
REVOKE UPDATE ON vault_private_sessions FROM neuralcore_issuer;
GRANT UPDATE(consented,consent_epoch,revoked_at) ON vault_private_sessions TO neuralcore_issuer;

CREATE FUNCTION vault_preserve_session_fence() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF (NEW.session_ref_hash,NEW.principal_id,NEW.identity_hash,NEW.expires_at)
    IS DISTINCT FROM (OLD.session_ref_hash,OLD.principal_id,OLD.identity_hash,OLD.expires_at)
    OR NEW.consent_epoch<OLD.consent_epoch THEN
   RAISE EXCEPTION 'SESSION_BINDING_IMMUTABLE';
 END IF;
 IF OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'SESSION_REVOKED';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION vault_preserve_session_fence() FROM PUBLIC;
CREATE TRIGGER vault_session_fence BEFORE UPDATE ON vault_private_sessions
 FOR EACH ROW EXECUTE FUNCTION vault_preserve_session_fence();
