'use client'

import { JOB_TAB_LABELS, type JobTab } from '@/lib/job-tabs'

/** Sticky Crews / Materials / Money / Notes / Files bar. A dot marks a tab that needs somebody. */
export default function JobTabsBar({
  tabs,
  active,
  attention,
  hideOnDesktop = [],
  onSelect,
}: {
  tabs: JobTab[]
  active: JobTab
  attention: JobTab[]
  /** Tabs whose content has a permanent side panel on a desktop (Notes). */
  hideOnDesktop?: JobTab[]
  onSelect: (tab: JobTab) => void
}) {
  return (
    <div className="sticky top-0 z-20 -mx-3 mb-3 border-b bg-white px-3 sm:mx-0 sm:rounded-xl sm:border sm:shadow-sm" role="tablist" aria-label="Job sections">
      <div className="flex overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            id={`job-tab-${tab}`}
            aria-selected={active === tab}
            onClick={() => onSelect(tab)}
            className={`relative min-h-[44px] flex-1 border-b-2 px-3 text-sm font-semibold ${hideOnDesktop.includes(tab) ? 'lg:hidden' : ''} ${
              active === tab ? 'border-indigo-700 text-indigo-800' : 'border-transparent text-[#2c2c2a] hover:bg-gray-50'
            }`}
          >
            {JOB_TAB_LABELS[tab]}
            {attention.includes(tab) && (
              <span className="absolute right-2 top-2.5 h-2 w-2 rounded-full bg-amber-500" aria-label="Needs attention" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
