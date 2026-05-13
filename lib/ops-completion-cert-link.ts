/** Matches API + JobFileWorkspaceCard: completion cert when job is wrapped up or collected */
export function canShowCompletionCertificateBoardLink(status: string | undefined | null): boolean {
  const n = (status ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  return n === 'complete' || n === 'collected'
}

export function opsJobCompletionCertificateHref(jobId: string): string {
  return `/ops/jobs/${jobId}#completion-certificate-tools`
}
