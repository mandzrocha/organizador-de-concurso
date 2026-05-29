'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exam } from '@/lib/types'
import { isSupabaseConfigured } from '@/lib/config'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface ExamWithStats extends Exam {
  subject_count: number
  progress: number
}

export default function ExamsPage() {
  const [exams, setExams] = useState<ExamWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => { loadExams() }, [])

  async function loadExams() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const { data: examsData } = await supabase.from('exams').select('*').order('is_primary', { ascending: false }).order('created_at')

    const withStats = await Promise.all((examsData || []).map(async exam => {
      const { data: es } = await supabase.from('exam_subjects').select('subject_id').eq('exam_id', exam.id)
      const subjectIds = (es || []).map(e => e.subject_id)
      const { data: topics } = await supabase.from('topics').select('id, completed_at').in('subject_id', subjectIds.length ? subjectIds : ['x'])
      const topicList = topics || []
      const topicIds = topicList.map(t => t.id)
      const { data: logs } = await supabase.from('study_logs').select('topic_id, activity_type').in('topic_id', topicIds.length ? topicIds : ['x'])
      const completedByTopic: Record<string, Set<string>> = {}
      for (const log of logs || []) {
        if (!completedByTopic[log.topic_id]) completedByTopic[log.topic_id] = new Set()
        completedByTopic[log.topic_id].add(log.activity_type)
      }
      const totalProgress = topicList.reduce((sum, t) => {
        if (t.completed_at) return sum + 100
        return sum + ((completedByTopic[t.id]?.size || 0) / 4) * 100
      }, 0)
      return { ...exam, subject_count: subjectIds.length, progress: topicIds.length ? Math.round(totalProgress / topicIds.length) : 0 }
    }))

    setExams(withStats)
    setLoading(false)
  }

  async function setPrimary(examId: string) {
    await supabase.from('exams').update({ is_primary: false }).neq('id', examId)
    await supabase.from('exams').update({ is_primary: true }).eq('id', examId)
    loadExams()
  }

  async function promoteToStudying(examId: string) {
    const exam = exams.find(e => e.id === examId)
    // If exam has no subjects yet, send to edital tab so user can attach one
    if (exam && exam.subject_count === 0) {
      router.push(`/exams/${examId}/edit?tab=edital`)
      return
    }
    await supabase.from('exams').update({ is_watching: false }).eq('id', examId)
    loadExams()
  }

  if (loading) return <LoadingState />

  const studying = exams.filter(e => !e.is_watching)
  const watching = exams.filter(e => e.is_watching)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Concursos</h1>
        <Link href="/exams/new" className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
          + Novo Concurso
        </Link>
      </div>

      {exams.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Nenhum concurso cadastrado ainda.</p>
          <Link href="/exams/new" className="px-4 py-2 rounded-lg text-sm font-medium inline-block" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
            Adicionar concurso
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
                {studying.map(exam => <StudyingExamCard key={exam.id} exam={exam} onSetPrimary={setPrimary} />)}
              </div>
            )}
          </section>

          {/* De olho */}
          {watching.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>👀 De olho</h2>
                <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                  {watching.length}
                </span>
                <span className="text-xs ml-1" style={{ color: 'var(--text-subtle)' }}>· aguardando edital, sem estudo ativo</span>
              </div>
              <div className="grid gap-3">
                {watching.map(exam => <WatchingExamCard key={exam.id} exam={exam} onPromote={promoteToStudying} />)}
              </div>
            </section>
          )}

          {/* Add watch button (always show if no watching items) */}
          {watching.length === 0 && studying.length > 0 && (
            <Link
              href="/exams/new?watching=1"
              className="block text-center rounded-xl border border-dashed py-4 text-sm font-medium transition-colors hover:border-[var(--primary)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              👀 Adicionar concurso para acompanhar (sem estudar ainda)
            </Link>
          )}
        </>
      )}
    </div>
  )
}

function StudyingExamCard({ exam, onSetPrimary }: { exam: ExamWithStats; onSetPrimary: (id: string) => void }) {
  const daysLeft = exam.exam_date ? differenceInDays(parseISO(exam.exam_date), new Date()) : null
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {exam.is_primary && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
                  ★ Foco principal
                </span>
              )}
              {exam.organization && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                  {exam.organization}
                </span>
              )}
              {!exam.exam_date && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                  📂 Pré-edital
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
                onClick={() => onSetPrimary(exam.id)}
                className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                Definir como foco
              </button>
            )}
            <Link
              href={`/exams/${exam.id}`}
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}
            >
              Ver detalhes
            </Link>
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
    </div>
  )
}

function WatchingExamCard({ exam, onPromote }: { exam: ExamWithStats; onPromote: (id: string) => void }) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', borderStyle: 'dashed' }}>
      <div className="p-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            {exam.organization && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                {exam.organization}
              </span>
            )}
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
              👀 De olho
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
            onClick={() => onPromote(exam.id)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
            style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}
            title="Mover para estudo ativo"
          >
            🚀 Estudar
          </button>
          <Link
            href={`/exams/${exam.id}/edit`}
            className="text-xs px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            Editar
          </Link>
        </div>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
      <p className="text-sm">Carregando...</p>
    </div>
  )
}
