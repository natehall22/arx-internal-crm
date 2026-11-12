-- Signing engine DB test (run by run-signing-engine.sh against a LOCAL Postgres with minimal orgs/users/contract tables):
-- 1) deleting a user who sent / voided a document works (evidence has no FK to users), 2) signing_events stays append-only.
INSERT INTO orgs(id) VALUES ('00000000-0000-0000-0000-0000000000a1');
INSERT INTO users(id) VALUES ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO signing_envelopes(id,org_id,doc_kind,doc_id,voided_by) VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','contract','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1');
INSERT INTO signing_events(org_id,envelope_id,doc_kind,doc_id,event,actor_type,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','contract','00000000-0000-0000-0000-0000000000d1','sent','staff','00000000-0000-0000-0000-0000000000b1');
DELETE FROM users WHERE id='00000000-0000-0000-0000-0000000000b1';
SELECT 'PASS user delete leaves evidence' WHERE (SELECT count(*) FROM signing_events) = 1;
-- A second 'signed' for the same signer is refused; another signer's is fine.
INSERT INTO signing_events(org_id,envelope_id,doc_kind,doc_id,event,signer_key,actor_type) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','contract','00000000-0000-0000-0000-0000000000d1','signed','customer','signer');
INSERT INTO signing_events(org_id,envelope_id,doc_kind,doc_id,event,signer_key,actor_type) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','contract','00000000-0000-0000-0000-0000000000d1','signed','company','signer');
DO $$ BEGIN
  BEGIN
    INSERT INTO signing_events(org_id,envelope_id,doc_kind,doc_id,event,signer_key,actor_type) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','contract','00000000-0000-0000-0000-0000000000d1','signed','customer','signer');
    RAISE EXCEPTION 'FAIL duplicate signed accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS duplicate signed refused';
  END;
  BEGIN UPDATE signing_events SET ip='x'; RAISE EXCEPTION 'FAIL update allowed';
  EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'PASS update refused'; END;
  BEGIN DELETE FROM signing_events; RAISE EXCEPTION 'FAIL delete allowed';
  EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'PASS delete refused'; END;
END $$;
