/**
 * The one place that knows the shape of the ops job-photo download route
 * (`app/api/ops/jobs/[id]/photos/[photoId]/download`). Used for thumbnails, the
 * full-size viewer, and "Open file" links.
 */
export function jobPhotoDownloadUrl(jobId: string, photoId: string) {
  return `/api/ops/jobs/${jobId}/photos/${photoId}/download`
}
