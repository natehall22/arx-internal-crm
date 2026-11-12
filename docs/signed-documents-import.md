# Move signed documents (I1)

Settings → Move signed documents (`/admin/import/signed-documents`, owners only). Brings contracts already signed in
DocuSign, Dropbox Sign or PandaDoc into customer documents as read-only copies. Migration
`202611190010_signed_documents_import.sql` (NOT applied; after 202611120040 and 202611110010).

## How it works
1. **Add**: the owner drops a ZIP, PDFs and/or an envelope list (.csv). The ZIP is opened in the browser
   (`lib/signed-import/zip.ts`), each PDF is hashed (SHA-256) and registered, then uploaded straight to storage
   (`<org>/imports/<id>_<name>`); the server re-reads the stored bytes (`%PDF-` + hash) before it counts the file.
2. **Check**: text is read from PDFs (`unpdf`, server side) and the CSV; files are grouped (agreement + certificate);
   each group is matched with the Jobber rules (`matchExistingCustomer`, `matchFileNames`). Ambiguous = the owner picks.
   No match = "keep for later" (a `documents` row with no customer). **Customers are never created.**
3. **Add to customers**: batches of 25, idempotent (fixed document id), resumable, summary at the end, undo.

Each file is stored once as `documents` (`signed_executed`; the certificate is `supporting_attachment`), with
`sha256`, `import_source`, `import_envelope_id`, `import_meta`. Duplicates (same hash, same company) are skipped.
Imported rows are never re-rendered; the customer documents routes have no replace or delete.

## Safety
- ZIP: header sizes are ignored; real bytes are counted (25 MB per file, work and entry-count caps); nested ZIPs,
  `..`/absolute/drive paths and control characters are skipped; only PDFs and CSVs are ever unzipped; nothing is run.
- Library: `fflate` (MIT, streaming `Unzip`, already in the tree via the PDF tools, now a direct dependency) so a
  500 MB export is read in the browser with backpressure. `unpdf` (MIT) for text.
- Owner only (`importOwner`), company scoped (`orgDb`), the server makes every storage path.

## Unverified (check with real exports before relying on it)
- Column header spellings of the DocuSign / Dropbox Sign / PandaDoc CSV reports, and the layout of their certificate
  text (`lib/signed-import/envelope-index.ts`, `cert-text.ts`). Unknown columns are ignored; matching then falls back
  to file names.
- `unpdf` declares Node >= 24; it ran on Node 22 here. `next.config.js` lists it under
  `serverComponentsExternalPackages`. `next build` was NOT run in this worktree.
- The mobile case (`move-signed-docs` in `e2e/mobile.spec.ts`) was written but the Playwright browser is not
  installed on this machine, so it has not been run.
- Wording shown on each imported document ("Signed in X, outside this system. Any certificate is the original tool's.")
  needs counsel review. An imported PDF is not an ESIGN/UETA record made by this system; the original tool's
  certificate is the evidence.

## Coordination with the signing engine
- `documents_linked_role_guard` is relaxed only when `import_source` is set (a signed role with no linked record).
- `sha256` here is Node `createHash`; the engine has its own `lib/signing/hash.ts`. Fold onto one when both land.
