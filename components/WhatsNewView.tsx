import { ROLE_GROUP_LABELS, type RoleGroup } from '@/lib/announcements'

/** The What's new page body: the announcement's copy for this person's role, plus a few screenshots. Nothing live. */
export default function WhatsNewView({
  title,
  group,
  lines,
  shots,
}: {
  title: string | null
  group: RoleGroup | null
  lines: string[]
  shots: Array<{ file: string; caption: string }>
}) {
  return (
    <main className="mx-auto max-w-2xl p-4 pb-12 text-[#2c2c2a]">
      <h1 className="mb-1 mt-2 text-2xl font-bold">What&apos;s new</h1>
      {!title || lines.length === 0 ? (
        <p className="mt-3 text-base">Nothing new to show right now.</p>
      ) : (
        <>
          <p className="mb-4 text-sm">
            {title}
            {group ? ` · for ${ROLE_GROUP_LABELS[group].toLowerCase()}` : ''}
          </p>
          <ul className="m-0 list-disc space-y-3 pl-5 text-base leading-snug">
            {lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          {shots.length > 0 && (
            <div className="mt-6 space-y-6">
              {shots.map((s) => (
                <figure key={s.file} className="m-0">
                  <img src={`/whats-new/${s.file}`} alt={s.caption} className="w-full max-w-[375px] rounded-lg border border-[#d3d1c7]" />
                  <figcaption className="mt-1 text-sm">{s.caption}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  )
}
