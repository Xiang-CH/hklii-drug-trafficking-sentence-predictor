import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { JudgementDetail } from '@/routes/api/judgements/$filename'
import { authClient } from '@/lib/auth-client'
import HtmlViewer from '@/components/html-viewer'

async function getJudgement(filename: string): Promise<JudgementDetail> {
  const response = await fetch(`/api/judgements/${filename}`)
  if (response.status === 401) {
    throw redirect({
      to: '/login',
      search: { redirect: `/admin/judgements/${filename}` },
    })
  }
  if (!response.ok) {
    throw new Error('Failed to load judgement')
  }
  return (await response.json()) as JudgementDetail
}

export const Route = createFileRoute('/admin/judgements/$filename')({
  component: JudgementDetailComponent,
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession()
    if (!session.data?.user) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    if (session.data.user.role !== 'admin') {
      throw redirect({ to: '/' })
    }
  },
  loader: async ({ params }) => {
    return getJudgement(params.filename)
  },
})

function JudgementDetailComponent() {
  const initial = Route.useLoaderData()
  const { filename } = Route.useParams()

  const { data } = useQuery({
    queryKey: ['judgement', filename],
    initialData: initial,
    queryFn: () => getJudgement(filename),
    gcTime: 0,
  })

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">
          {data.trial ?? data.filename}
          {data.appeal ? ` (${data.appeal})` : ''}
          {data.corrigendum ? ` (${data.corrigendum})` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          Filename: {data.filename}
          {data.year && ` | Year: ${data.year}`}
          {data.updatedAt &&
            ` | Updated: ${new Date(data.updatedAt).toLocaleString()}`}
        </p>
      </div>
      {data.appeal_html && (
        <HtmlViewer html={data.appeal_html} highlightedText={null} />
      )}
      {data.corrigendum_html && (
        <HtmlViewer html={data.corrigendum_html} highlightedText={null} />
      )}
      <HtmlViewer html={data.trial_html} highlightedText={null} />
    </div>
  )
}
