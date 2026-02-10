import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '@/lib/auth'

export const authMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const headers = getRequestHeaders()
    const session = await auth.api.getSession({ headers })

    console.log(JSON.stringify({ headers }, null, 2))
    request.headers.get('referer') &&
      console.log('Referer:', request.headers.get('referer'))
    const path = new URL(request.headers.get('referer') || '').pathname
    console.log('Auth Middleware:', path)

    if (!session) {
      throw redirect({ to: '/login', search: { redirect: path } })
    }

    if (path.startsWith('/admin') && session.user.role !== 'admin') {
      throw redirect({ to: '/login', search: { redirect: '/' } })
    }

    return await next({
      context: {
        session,
      },
    })
  },
)
