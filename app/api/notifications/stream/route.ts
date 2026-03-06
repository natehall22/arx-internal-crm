import { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()
  let isConnected = true
  let intervalId: NodeJS.Timeout | null = null

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: any) => {
        if (!isConnected) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          isConnected = false
        }
      }

      const sendKeepAlive = () => {
        if (!isConnected) return
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {
          isConnected = false
        }
      }

      const fetchAndSendData = async () => {
        if (!isConnected) return

        try {
          // Fetch notifications
          const { data: notifications } = await supabase
            .from('notifications')
            .select('*')
            .eq('recipient_user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(10)

          const { count: unreadCount } = await supabase
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('recipient_user_id', user.id)
            .is('read_at', null)

          sendEvent('notifications', {
            notifications: notifications || [],
            unread_count: unreadCount || 0,
          })

          // Fetch user profile to determine role
          const { data: profile } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .single()

          const role = profile?.role || ''
          const isCloser = ['closer', 'rep', 'sales_rep', 'admin', 'manager'].includes(role)
          const isSetter = ['setter', 'canvasser'].includes(role)

          // For closers: fetch pending appointment feedback prompts
          if (isCloser) {
            const { data: prompts } = await supabase
              .from('pending_status_prompts')
              .select(`
                id,
                appointment_id,
                prompt_at,
                scheduled_appointments!inner (
                  id,
                  scheduled_for,
                  address_text,
                  lead_id,
                  leads (
                    id,
                    homeowner_name,
                    address_text
                  ),
                  setter:users!scheduled_appointments_setter_user_id_fkey (
                    full_name
                  )
                )
              `)
              .eq('closer_user_id', user.id)
              .eq('completed', false)
              .eq('dismissed', false)
              .lte('prompt_at', new Date().toISOString())
              .order('prompt_at', { ascending: true })

            sendEvent('appointment_prompts', {
              prompts: prompts || [],
            })
          }

          // For setters: fetch inspection results notifications
          if (isSetter) {
            const { data: results } = await supabase
              .from('notifications')
              .select('*')
              .eq('recipient_user_id', user.id)
              .eq('type', 'inspection_outcome')
              .is('read_at', null)
              .order('created_at', { ascending: false })

            sendEvent('inspection_results', {
              results: results || [],
            })
          }
        } catch (error) {
          console.error('SSE fetch error:', error)
        }
      }

      // Send initial data immediately
      await fetchAndSendData()

      // Poll database every 10 seconds and push updates
      intervalId = setInterval(async () => {
        if (!isConnected) {
          if (intervalId) clearInterval(intervalId)
          return
        }
        await fetchAndSendData()
      }, 10000)

      // Send keepalive every 30 seconds to prevent connection timeout
      const keepAliveId = setInterval(sendKeepAlive, 30000)

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        isConnected = false
        if (intervalId) clearInterval(intervalId)
        clearInterval(keepAliveId)
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },

    cancel() {
      isConnected = false
      if (intervalId) clearInterval(intervalId)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
