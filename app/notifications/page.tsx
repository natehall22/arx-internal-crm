'use client'

import { useState, useEffect } from 'react'
import Nav from '@/components/Nav'
import Link from 'next/link'
import type { Notification } from '@/lib/types/database'

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const fetchNotifications = async () => {
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (filter === 'unread') {
        params.set('unread', 'true')
      }
      
      const res = await fetch(`/api/notifications?${params}`)
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications)
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
  }, [filter])

  const markAsRead = async (ids?: string[]) => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { notification_ids: ids } : { mark_all: true }),
      })
      fetchNotifications()
    } catch (error) {
      console.error('Failed to mark as read:', error)
    }
  }

  const getNotificationIcon = (type: string, outcome?: string) => {
    if (type === 'inspection_outcome') {
      const iconColors: Record<string, { bg: string; text: string }> = {
        sale: { bg: 'bg-green-100', text: 'text-green-600' },
        moving_to_close: { bg: 'bg-green-100', text: 'text-green-600' },
        said_no: { bg: 'bg-gray-100', text: 'text-gray-600' },
        not_home: { bg: 'bg-red-100', text: 'text-red-600' },
        rescheduled: { bg: 'bg-amber-100', text: 'text-amber-600' },
        no_problems_found: { bg: 'bg-blue-100', text: 'text-blue-600' },
        failed_credit: { bg: 'bg-red-100', text: 'text-red-600' },
      }
      const colors = iconColors[outcome || ''] || { bg: 'bg-blue-100', text: 'text-blue-600' }
      
      return (
        <div className={`w-12 h-12 rounded-full ${colors.bg} flex items-center justify-center`}>
          <svg className={`w-6 h-6 ${colors.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
      )
    }
    
    if (type === 'reschedule') {
      return (
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )
    }
    
    return (
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      </div>
    )
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
    })
  }

  const unreadCount = notifications.filter(n => !n.read_at).length

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
            <p className="text-gray-500 text-sm mt-1">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Filter Toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  filter === 'all' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  filter === 'unread' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Unread
              </button>
            </div>
            
            {unreadCount > 0 && (
              <button
                onClick={() => markAsRead()}
                className="px-4 py-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition"
              >
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Notifications List */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="text-gray-500 mt-2">Loading notifications...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">No notifications</h3>
              <p className="text-gray-500">
                {filter === 'unread' ? "You're all caught up!" : "You don't have any notifications yet."}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => {
                const data = notification.data as Record<string, any> | null
                const outcome = data?.outcome
                
                return (
                  <div
                    key={notification.id}
                    onClick={() => !notification.read_at && markAsRead([notification.id])}
                    className={`p-4 hover:bg-gray-50 transition cursor-pointer ${
                      !notification.read_at ? 'bg-indigo-50/30' : ''
                    }`}
                  >
                    <div className="flex gap-4">
                      {getNotificationIcon(notification.type, outcome)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm ${!notification.read_at ? 'font-semibold' : 'font-medium'} text-gray-900`}>
                            {notification.title}
                          </p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs text-gray-500">
                              {formatTime(notification.created_at)}
                            </span>
                            {!notification.read_at && (
                              <div className="w-2 h-2 bg-indigo-500 rounded-full" />
                            )}
                          </div>
                        </div>
                        {notification.body && (
                          <div className="mt-2 text-sm text-gray-600 whitespace-pre-line bg-gray-50 p-3 rounded-lg">
                            {notification.body}
                          </div>
                        )}
                        
                        {/* Action buttons based on notification type */}
                        {notification.type === 'inspection_outcome' && data?.lead_id && (
                          <div className="mt-3 flex gap-2">
                            <Link
                              href={`/leads/${data.lead_id}`}
                              className="text-xs px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View Lead
                            </Link>
                            {data?.opportunity_id && (
                              <Link
                                href={`/opportunities/${data.opportunity_id}`}
                                className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                                onClick={(e) => e.stopPropagation()}
                              >
                                View Opportunity
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Back to Dashboard */}
        <div className="mt-6 text-center">
          <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-700 text-sm font-medium">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
