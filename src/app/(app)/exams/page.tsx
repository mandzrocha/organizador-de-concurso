'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exam } from '@/lib/types'
import { isSupabaseConfigured } from '@/lib/config'
import { unenrollExam } from '@/lib/exam-actions'
import { getUserId } from '@/lib/auth'
import { matchEditalNews } from '@/lib/edital-news'
import { getDismissed, dismissAlert, alertId } from '@/lib/dismissed-alerts'
import type { NewsItem } from '@/app/api/news/route'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { PageSkeleton } from '@/components/Skeleton'
import { useDataChanged } from '@/lib/events'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, Star, Eye, FolderOpen, Trash2, Rocket, Pencil, ClipboardList, Bell, ExternalLink, X } from 'lucide-react'

interface ExamWithStats extends Exam {
  subject_count: number
  progress: number
}

export default function ExamsPage() {
  const [exams, setExams] = useState<ExamWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [news, setNews] = useState<NewsItem[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const supabase = createClient()
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()

  useEffect(() => { loadExams() }, [])
  useDataChanged(() => { loadExams() })

  // Busca notícias uma vez para detectar possíveis editais novos
  useEffect(() => {
    fetch('/api/news').then(r => r.json()).then(d => setNews(d.items || [])).catch(() => {})
    setDismissed(getDismissed())
  }, [])

  // Concursos que valem alerta: "de olho" ou em pré-edital (sem data),
  // exceto os que o usuário já dispensou
  const editalAlerts = useMemo(() => {
    if (news.length === 0) return {} as Record<string, NewsItem>
    const watchOrPre = exams.filter(e => e.is_watching || !e.exam_date)
    const matches = matchEditalNews(watchOrPre, news)
    const out: Record<string, NewsItem> = {}
    for (const [examId, item] of Object.entries(matches)) {
      if (!dismissed.has(alertId(examId, item.link))) out[examId] = item
    }
    return out
  }, [exams, news, dismissed])

  function dismiss(examId: string, link: string) {
    dismissAlert(alertId(examId, link))
    setDismissed(new Set([...dismissed, alertId(examId, link)]))
  }

  async function loadExams() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const userId = await getUserId(supabase)
    if (!userId) { setLoading(false); return }

    // Concursos em que ESTE usuário está inscrito (flags vêm de user_exams)
    const { data: enrollments } = await supabase
      .from('user_exams')
      .select('is_primary, is_watching, created_at, exam:exams(*)')
      .eq('user_id', userId)
      .order('created_at')
    const rows = (enrollments || []).filter((r: any) => r.exam)

    // Tópicos concluídos por este usuário
    const { data: tp } = await supabase
      .from('user_topic_progress')
      .select('topic_id, completed_at')
      .eq('user_id', userId)
    const completedTopics = new Set((tp || []).filter((t: any) => t.completed_at).map((t: any) => t.topic_id))

    const withStats = await Promise.all(rows.map(async (row: any) => {
      const exam = row.exam
      const { data: es } = await supabase.from('exam_subjects').select('subject_id').eq('exam_id', exam.id)
      const subjectIds = (es || []).map((e: any) => e.subject_id)
      const { data: topics } = await supabase.from('topics').select('id').eq('exam_id', exam.id)
      const topicList = topics || []
      const topicIds = topicList.map((t: any) => t.id)
      const { data: logs } = await supabase.from('study_logs').select('topic_id, activity_type').eq('user_id', userId).in('topic_id', topicIds.length ? topicIds : ['x'])
      const completedByTopic: Record<string, Set<string>> = {}
      for (const log of logs || []) {
        if (!completedByTopic[log.topic_id]) completedByTopic[log.topic_id] = new Set()
        completedByTopic[log.topic_id].add(log.activity_type)
      }
      const totalProgress = topicList.reduce((sum: number, t: any) => {
        if (completedTopics.has(t.id)) return sum + 100
        return sum + ((completedByTopic[t.id]?.size || 0) / 4) * 100
      }, 0)
      return {
        ...exam,
        is_primary: row.is_primary,
        is_watching: row.is_watching,
        subject_count: subjectIds.length,
        progress: topicIds.length ? Math.round(totalProgress / topicIds.length) : 0,
      }
    }))

    withStats.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
    setExams(withStats)
    setLoading(false)
  }

  async function setPrimary(examId: string) {
    const userId = await getUserId(supabase)
    if (!userId) return
    await supabase.from('user_exams').update({ is_primary: false }).eq('user_id', userId)
    await supabase.from('user_exams').update({ is_primary: true }).eq('user_id', userId).eq('exam_id', examId)
    toast.success('Concurso definido como foco principal')
    loadExams()
  }

  async function deleteExam(examId: string, examName: string) {
    const ok = await confirm({
      title: `Remover "${examName}" dos seus estudos?`,
      message: 'Isso apaga o SEU histórico de estudos, revisões, planos e progresso deste concurso. O edital e as matérias continuam disponíveis na biblioteca.',
      confirmLabel: 'Remover',
      danger: true,
    })
    if (!ok) return
    try {
      const userId = await getUserId(supabase)
      if (!userId) return
      await unenrollExam(supabase, examId, userId)
      toast.success(`"${examName}" removido dos seus estudos`)
      loadExams()
    } catch (e: any) {
      toast.error('Erro ao remover: ' + e.message)
    }
  }

  async function promoteToStudying(examId: string) {
    const exam = exams.find(e => e.id === examId)
    // If exam has no subjects yet, send to edital tab so user can attach one
    if (exam && exam.subject_count === 0) {
      router.push(`/exams/${examId}/edit?tab=edital`)
      return
    }
    const userId = await getUserId(supabase)
    if (!userId) return
    await supabase.from('user_exams').update({ is_watching: false }).eq('user_id', userId).eq('exam_id', examId)
    toast.success('Concurso movido para estudo ativo')
    loadExams()
  }

  if (loading) return <PageSkeleton variant="list" />

  const studying = exams.filter(e => !e.is_watching)
  const watching = exams.filter(e => e.is_watching)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Concursos</h1>
        <Link href="/exams/new" className="px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
          <Plus size={14} strokeWidth={2.5} /> Novo Concurso
        </Link>
      </div>

      {/* Aviso de possível edital novo (cruza concursos de olho / pré-edital com notícias) */}
      {Object.keys(editalAlerts).length > 0 && (
        <div className="rounded-2xl border p-4" style={{ background: 'var(--primary-soft)', borderColor: 'var(--primary)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Bell size={15} style={{ color: 'var(--primary-strong)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--primary-soft-text)' }}>Pode ter saído edital</h3>
          </div>
          <div className="space-y-1.5">
            {exams.filter(e => editalAlerts[e.id]).map(e => {
              const n = editalAlerts[e.id]
              return (
                <div key={e.id} className="flex items-start gap-2 text-sm">
                  <span className="font-medium flex-shrink-0" style={{ color: 'var(--text)' }}>{e.name}:</span>
                  <a href={n.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 hover:underline" style={{ color: 'var(--primary-strong)' }}>
                    <span>{n.title}</span>
                    <ExternalLink size={12} className="flex-shrink-0 mt-0.5" />
                  </a>
                  <Link href={`/exams/${e.id}/edit?tab=edital`} className="ml-auto text-xs whitespace-nowrap px-2 py-1 rounded-md flex-shrink-0" style={{ background: 'var(--surface)', color: 'var(--primary-strong)' }}>
                    Atualizar edital
                  </Link>
                  <button onClick={() => dismiss(e.id, n.link)} className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors hover:bg-[var(--surface)]" style={{ color: 'var(--text-subtle)' }} title="Dispensar aviso" aria-label="Dispensar aviso">
                    <X size={14} />
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Detectado nas notícias — confira na fonte antes de confiar.</p>
        </div>
      )}

      {exams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            <ClipboardList size={30} strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>Nenhum concurso cadastrado</h2>
          <p className="text-sm mb-6 max-w-xs" style={{ color: 'var(--text-muted)' }}>Adicione seu primeiro concurso com o edital em PDF para começar.</p>
          <Link href="/exams/new" className="px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
            <Plus size={14} strokeWidth={2.5} /> Adicionar concurso
          </Link>
        </div>
      ) : (
        <>
          {/* Estudando */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Estudando</h2>
              {studying.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                  {studying.length}
                </span>
              )}
            </div>
            {studying.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center" style={{ borderColor: 'var(--border)' }}>
                <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>Nenhum concurso ativo agora.</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {studying.map(exam => <StudyingExamCard key={exam.id} exam={exam} onSetPrimary={setPrimary} onDelete={() => deleteExam(exam.id, exam.name)} />)}
              </div>
            )}
          </section>

          {/* De olho */}
          {watching.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Eye size={14} style={{ color: 'var(--warning)' }} />
                <h2 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>De olho</h2>
                <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                  {watching.length}
                </span>
                <span className="text-xs ml-1" style={{ color: 'var(--text-subtle)' }}>· aguardando edital, sem estudo ativo</span>
              </div>
              <div className="grid gap-3">
                {watching.map(exam => <WatchingExamCard key={exam.id} exam={exam} onPromote={promoteToStudying} onDelete={() => deleteExam(exam.id, exam.name)} />)}
              </div>
            </section>
          )}

          {/* Add watch button (always show if no watching items) */}
          {watching.length === 0 && studying.length > 0 && (
            <Link
              href="/exams/new?watching=1"
              className="flex items-center justify-center gap-2 text-center rounded-xl border border-dashed py-4 text-sm font-medium transition-colors hover:border-[var(--primary)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              <Eye size={16} /> Adicionar concurso para acompanhar (sem estudar ainda)
            </Link>
          )}
        </>
      )}
    </div>
  )
}

function StudyingExamCard({ exam, onSetPrimary, onDelete }: { exam: ExamWithStats; onSetPrimary: (id: string) => void; onDelete: () => void }) {
  const daysLeft = exam.exam_date ? differenceInDays(parseISO(exam.exam_date), new Date()) : null
  return (
    <Link
      href={`/exams/${exam.id}`}
      className="ef-card ef-hover-lift overflow-hidden block"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {exam.is_primary && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
                  <Star size={11} fill="currentColor" strokeWidth={0} /> Foco principal
                </span>
              )}
              {exam.organization && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                  {exam.organization}
                </span>
              )}
              {!exam.exam_date && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                  <FolderOpen size={11} /> Pré-edital
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{exam.name}</h2>
            <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>{exam.subject_count} matérias</span>
              {exam.exam_date ? (
                <span>
                  Prova: {format(parseISO(exam.exam_date), "d MMM yyyy", { locale: ptBR })}
                  {daysLeft !== null && daysLeft >= 0 && (
                    <span className="ml-1" style={{ color: daysLeft < 30 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      ({daysLeft}d restantes)
                    </span>
                  )}
                </span>
              ) : (
                <span style={{ color: 'var(--warning)' }}>Sem data definida — edital anterior como referência</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {!exam.is_primary && (
              <button
                onClick={(e) => { e.preventDefault(); onSetPrimary(exam.id) }}
                className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--surface-hover)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                Definir como foco
              </button>
            )}
            <button
              onClick={(e) => { e.preventDefault(); onDelete() }}
              className="w-8 h-8 rounded-lg border flex items-center justify-center transition-colors hover:bg-[var(--danger-soft)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}
              title="Excluir concurso"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-1">
          <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>Progresso geral</span>
            <span style={{ color: 'var(--text)' }}>{exam.progress}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: `${exam.progress}%`,
                background: exam.is_primary ? 'linear-gradient(90deg, var(--primary-strong), var(--primary))' : 'var(--text-muted)',
              }}
            />
          </div>
        </div>
      </div>
    </Link>
  )
}

function WatchingExamCard({ exam, onPromote, onDelete }: { exam: ExamWithStats; onPromote: (id: string) => void; onDelete: () => void }) {
  return (
    <Link
      href={`/exams/${exam.id}/edit`}
      className="rounded-2xl border overflow-hidden block ef-hover-lift"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', borderStyle: 'dashed' }}
    >
      <div className="p-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            {exam.organization && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                {exam.organization}
              </span>
            )}
            <span className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
              <Eye size={11} /> De olho
            </span>
          </div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{exam.name}</h3>
          {exam.description && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{exam.description}</p>
          )}
          <p className="text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>
            Adicionado em {format(parseISO(exam.created_at), "d MMM yyyy", { locale: ptBR })}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => { e.preventDefault(); onPromote(exam.id) }}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
            style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}
            title="Mover para estudo ativo"
          >
            <Rocket size={12} /> Estudar
          </button>
          <button
            onClick={(e) => { e.preventDefault(); onDelete() }}
            className="w-8 h-8 rounded-lg border flex items-center justify-center transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}
            title="Excluir concurso"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Link>
  )
}

