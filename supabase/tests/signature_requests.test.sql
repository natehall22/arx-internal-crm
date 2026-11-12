-- Signature requests DB test (run by run-signature-requests.sh after 202611200010 + 202611200020 on a LOCAL Postgres).
INSERT INTO orgs(id) VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
-- 1) an envelope can be about a signature request; an unknown kind is still refused
INSERT INTO signing_envelopes(id,org_id,doc_kind,doc_id) VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','signature-request','00000000-0000-0000-0000-0000000000d1');
SELECT 'PASS envelope accepts signature-request' WHERE (SELECT count(*) FROM signing_envelopes WHERE doc_kind='signature-request') = 1;
DO $$ BEGIN
  BEGIN INSERT INTO signing_envelopes(org_id,doc_kind,doc_id) VALUES ('00000000-0000-0000-0000-0000000000a1','bogus','00000000-0000-0000-0000-0000000000d2'); RAISE EXCEPTION 'FAIL bogus kind accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS unknown kind refused'; END;
END $$;
-- 2) request + signers + fields; defaults
INSERT INTO signature_requests(id,org_id,title,source_path,source_sha256,page_count,expires_at) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','Lease','org/a/x.pdf',repeat('a',64),1, now() + interval '7 days');
SELECT 'PASS request defaults pending/parallel' WHERE (SELECT status||signing_order FROM signature_requests) = 'pendingparallel';
INSERT INTO signature_request_signers(org_id,request_id,role_key,role_label,name,email,order_index,token_hash) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1','owner','Owner','O','o@x.test',0,'h1');
DO $$ BEGIN
  BEGIN INSERT INTO signature_request_signers(org_id,request_id,role_key,role_label,name,email,order_index,token_hash) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1','owner','Owner','O2','o2@x.test',1,'h2'); RAISE EXCEPTION 'FAIL duplicate role accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS one signer per role'; END;
  BEGIN INSERT INTO signature_request_signers(org_id,request_id,role_key,role_label,name,email,order_index,token_hash) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1','t','T','T','t@x.test',1,'h1'); RAISE EXCEPTION 'FAIL duplicate token accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS token hash unique'; END;
  BEGIN UPDATE signature_request_signers SET status='weird'; RAISE EXCEPTION 'FAIL bad status accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS signer status checked'; END;
END $$;
-- 3) not readable by the app roles (service role only)
DO $$ BEGIN
  IF has_table_privilege('anon','signature_requests','SELECT') OR has_table_privilege('authenticated','signature_request_signers','SELECT') THEN RAISE EXCEPTION 'FAIL app roles can read';
  ELSE RAISE NOTICE 'PASS anon/authenticated have no access'; END IF;
END $$;
-- 4) deleting a request removes its signers and fields
INSERT INTO signature_fields(org_id,request_id,role_key,kind,page,x,y,w,h) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1','owner','signature',0,0.1,0.1,0.2,0.05);
DELETE FROM signature_requests;
SELECT 'PASS delete cascades' WHERE (SELECT count(*) FROM signature_request_signers) + (SELECT count(*) FROM signature_fields) = 0;
