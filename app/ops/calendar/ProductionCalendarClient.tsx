'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

export interface ProductionCalendarJob {
  id: string
  job_number: string
  status: string
  job_type: string
  address_text: string
  scheduled_date: string | null
  scheduled_time_start: string | null
  estimated_duration_hours: number | null
  priority: string
  assigned_crew?: { id: string; name: string; color: string } | null
  assigned_sub?: { id: string; company_name: string } | null
  customer?: { name: string } | null
}

export interface ProductionCalendarCrew {
  id: string
  name: string
  color: string
  daily_capacity: number
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

type Props = {
  jobs: ProductionCalendarJob[]
  crews: ProductionCalendarCrew[]
  canJobBoard: boolean
}

export default function ProductionCalendarClient({ jobs, crews, canJobBoard }: Props) {
  const router = useRouter()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'month' | 'week'>('week')
  const [filterCrew, setFilterCrew] = useState<string>('all')

  const getWeekDates = (date: Date) => {
    const start = new Date(date)
    start.setDate(start.getDate() - start.getDay())

    const dates: Date[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      dates.push(d)
    }
    return dates
  }

  const getMonthDates = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    const dates: { date: Date; isCurrentMonth: boolean }[] = []

    const startPadding = firstDay.getDay()
    for (let i = startPadding - 1; i >= 0; i--) {
      const d = new Date(year, month, -i)
      dates.push({ date: d, isCurrentMonth: false })
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      dates.push({ date: new Date(year, month, i), isCurrentMonth: true })
    }

    const endPadding = 42 - dates.length
    for (let i = 1; i <= endPadding; i++) {
      dates.push({ date: new Date(year, month + 1, i), isCurrentMonth: false })
    }

    return dates
  }

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate])
  const monthDates = useMemo(() => getMonthDates(currentDate), [currentDate])

  const getJobsForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0]
    return jobs.filter((job) => {
      if (job.scheduled_date?.split('T')[0] !== dateStr) return false
      if (filterCrew !== 'all' && job.assigned_crew?.id !== filterCrew) return false
      return true
    })
  }

  const navigateWeek = (direction: number) => {
    const newDate = new Date(currentDate)
    newDate.setDate(newDate.getDate() + direction * 7)
    setCurrentDate(newDate)
  }

  const navigateMonth = (direction: number) => {
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() + direction)
    setCurrentDate(newDate)
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  const isToday = (date: Date) => {
    const today = new Date()
    return date.toDateString() === today.toDateString()
  }

  const formatDateHeader = () => {
    if (viewMode === 'week') {
      const start = weekDates[0]
      const end = weekDates[6]
      if (start.getMonth() === end.getMonth()) {
        return `${MONTHS[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`
      }
      return `${MONTHS[start.getMonth()]} ${start.getDate()} - ${MONTHS[end.getMonth()]} ${end.getDate()}, ${start.getFullYear()}`
    }
    return `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
  }

  const JobCard = ({ job }: { job: ProductionCalendarJob }) => {
    const bgColor = job.assigned_crew?.color || '#6B7280'

    return (
      <div
        onClick={() => canJobBoard && router.push(`/ops/jobs/${job.id}`)}
        className={`px-2 py-1.5 rounded text-xs transition mb-1 ${canJobBoard ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
        style={{
          backgroundColor: `${bgColor}15`,
          borderLeft: `3px solid ${bgColor}`,
        }}
      >
        <div className="font-medium text-gray-900 truncate">
          {job.customer?.name || job.address_text.split(',')[0]}
        </div>
        <div className="text-gray-500 truncate">
          {job.assigned_crew?.name || job.assigned_sub?.company_name || 'Unassigned'}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />

      <div className="max-w-[1800px] mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Production Calendar</h1>
            <p className="text-gray-500 text-sm">View and manage scheduled jobs</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={canJobBoard ? '/ops' : '/ops/dashboard'}
              className="px-4 py-2 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
            >
              {canJobBoard ? '← Back to Board' : '← Ops Dashboard'}
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-4 mb-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => (viewMode === 'week' ? navigateWeek(-1) : navigateMonth(-1))}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-lg font-semibold text-gray-900 min-w-[250px] text-center">
                {formatDateHeader()}
              </h2>
              <button
                type="button"
                onClick={() => (viewMode === 'week' ? navigateWeek(1) : navigateMonth(1))}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={goToToday}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Today
              </button>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={filterCrew}
                onChange={(e) => setFilterCrew(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="all">All Crews</option>
                {crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name}
                  </option>
                ))}
              </select>
              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode('week')}
                  className={`px-4 py-2 text-sm ${viewMode === 'week' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  Week
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('month')}
                  className={`px-4 py-2 text-sm ${viewMode === 'month' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  Month
                </button>
              </div>
            </div>
          </div>
        </div>

        {crews.length > 0 && (
          <div className="bg-white rounded-lg border p-4 mb-6">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Crews:</span>
              {crews.map((crew) => (
                <div key={crew.id} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: crew.color }} />
                  <span className="text-sm text-gray-600">{crew.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {viewMode === 'week' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="grid grid-cols-7 border-b">
              {weekDates.map((date, idx) => (
                <div
                  key={idx}
                  className={`p-3 text-center border-r last:border-r-0 ${isToday(date) ? 'bg-indigo-50' : ''}`}
                >
                  <div className="text-xs text-gray-500 uppercase">{DAYS_OF_WEEK[date.getDay()]}</div>
                  <div className={`text-lg font-semibold ${isToday(date) ? 'text-indigo-600' : 'text-gray-900'}`}>
                    {date.getDate()}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 min-h-[500px]">
              {weekDates.map((date, idx) => {
                const dayJobs = getJobsForDate(date)
                return (
                  <div
                    key={idx}
                    className={`p-2 border-r last:border-r-0 ${isToday(date) ? 'bg-indigo-50/30' : ''}`}
                  >
                    {dayJobs.length === 0 ? (
                      <div className="text-center text-gray-400 text-xs py-4">
                        No jobs
                      </div>
                    ) : (
                      dayJobs.map((job) => <JobCard key={job.id} job={job} />)
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {viewMode === 'month' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="grid grid-cols-7 border-b bg-gray-50">
              {DAYS_OF_WEEK.map((day) => (
                <div key={day} className="p-3 text-center text-xs font-medium text-gray-500 uppercase">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {monthDates.map(({ date, isCurrentMonth }, idx) => {
                const dayJobs = getJobsForDate(date)
                return (
                  <div
                    key={idx}
                    className={`min-h-[120px] p-2 border-r border-b ${!isCurrentMonth ? 'bg-gray-50' : ''} ${isToday(date) ? 'bg-indigo-50/50' : ''}`}
                  >
                    <div
                      className={`text-sm font-medium mb-1 ${
                        isToday(date) ? 'text-indigo-600' : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                      }`}
                    >
                      {date.getDate()}
                    </div>
                    <div className="space-y-1">
                      {dayJobs.slice(0, 3).map((job) => (
                        <div
                          key={job.id}
                          onClick={() => canJobBoard && router.push(`/ops/jobs/${job.id}`)}
                          className={`px-1.5 py-0.5 rounded text-xs truncate ${canJobBoard ? 'cursor-pointer' : 'cursor-default'}`}
                          style={{
                            backgroundColor: `${job.assigned_crew?.color || '#6B7280'}20`,
                            color: job.assigned_crew?.color || '#6B7280',
                          }}
                        >
                          {job.customer?.name || job.job_number}
                        </div>
                      ))}
                      {dayJobs.length > 3 && (
                        <div className="text-xs text-gray-500 pl-1">+{dayJobs.length - 3} more</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-gray-900">{jobs.length}</div>
            <div className="text-sm text-gray-500">Scheduled Jobs</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-indigo-600">
              {jobs.filter((j) => j.status === 'in_progress').length}
            </div>
            <div className="text-sm text-gray-500">In Progress</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-purple-600">{getJobsForDate(new Date()).length}</div>
            <div className="text-sm text-gray-500">Today</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-2xl font-bold text-green-600">
              {weekDates.reduce((sum, date) => sum + getJobsForDate(date).length, 0)}
            </div>
            <div className="text-sm text-gray-500">This Week</div>
          </div>
        </div>
      </div>
    </div>
  )
}
