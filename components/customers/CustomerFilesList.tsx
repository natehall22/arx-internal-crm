import CustomerFilesUpload from '@/components/customers/CustomerFilesUpload'
import type { CustomerFileRow } from '@/lib/customer-file/customer-files'
import { filesObjectHref } from '@/lib/files/files-object'

/** The customer's files (from loadCustomerFiles) with the "Add files" box on top when the viewer may add. Used by both customer pages. */
export default function CustomerFilesList({ customerId, files, canAdd }: { customerId: string; files: CustomerFileRow[]; canAdd: boolean }) {
  return (
    <div>
      {canAdd && <CustomerFilesUpload customerId={customerId} />}
      {files.length === 0 ? (
        <p className="text-ui-sm text-ink-muted">No files yet for this customer.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => {
            const href = filesObjectHref(file.storage_path)
            return (
              <li key={file.id} className="flex items-center justify-between gap-3 rounded-ui border border-surface-line p-2">
                <div className="min-w-0">
                  <p className="truncate text-ui-sm text-ink">{file.file_name}</p>
                  <p className="text-ui-sm capitalize text-ink-muted">{file.tag}</p>
                </div>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-tap shrink-0 items-center px-2 text-ui-sm font-semibold text-brand-800 underline">
                    Open
                  </a>
                ) : (
                  <span className="text-ui-sm text-ink-muted">No link</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
