import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '@/lib/auth'

export const authMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const headers = getRequestHeaders()
    const session = await auth.api.getSession({ headers })

    if (!session) {
      throw redirect({ to: '/login', search: { redirect: request.url } })
    }

    const path = new URL(request.url).pathname

    if (path.startsWith('/admin') && session.user.role !== 'admin') {
      throw redirect({ to: '/login', search: { redirect: '/' } })
    }

    return await next()
  },
)
