'use client'

import { useState, useEffect } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'
import FeedbackModal from './FeedbackModal'

export default function FeedbackButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => {
    const loadUserInfo = async () => {
      const supabase = createClientBrowser()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        const email = user.email || ''
        setUserEmail(email)
        
        const { data: profile } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', user.id)
          .single()
        
        if (profile?.full_name) {
          setUserName(profile.full_name)
        } else if (email) {
          // Fallback to email username if no full_name set
          const emailName = email.split('@')[0]
          // Capitalize and replace dots/underscores with spaces
          const formattedName = emailName
            .replace(/[._]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase())
          setUserName(formattedName)
        }
      }
    }
    
    loadUserInfo()
  }, [])

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-full transition-colors"
        title="Send Feedback"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      <FeedbackModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        userName={userName}
        userEmail={userEmail}
      />
    </>
  )
}
