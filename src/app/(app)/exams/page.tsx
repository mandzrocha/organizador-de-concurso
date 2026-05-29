'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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

  useEffect(() => { loadExams() }, [])

  async function loadExams() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const { data: examsData } = await supabase.from('exams').select('*').order('is_primary', { ascending: false }).order('created_at')

    const withStats = await Promise.all((examsData || []).map(async exam => {
      const { data: es } = await supabase.from('exam_subjects').select('subject_id').eq('exam_id', exam.id)
      const subjectIds = (es || []).map(e => e.subject_id)
      const { data: topics } = await supabase.from('topics').select('id').in('subject_id', subjectIds.length ? subjectIds : ['x'])
      const topicIds = (topics || []).map(t => t.id)
      const { data: logs } = await supabase.from('study_logs').select('topic_id, activity_type').in('topic_id', topicIds.length ? topicIds : ['x'])
      const completedByTopic: Record<string, Set<string>> = {}
      for (const log of logs || []) {
        if (!completedByTopic[log.topic_id]) completedByTopic[log.topic_id] = new Set()
        completedByTopic[log.topic_id].add(log.activity_type)
      }
      const totalProgress = topicIds.reduce((sum, id) => sum + ((completedByTopic[id]?.size || 0) / 4) * 100, 0)
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

  if (loading) return <LoadingState />

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>Concursos</h1>
        <Link href="/exams/new" className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: '#6366f1', color: '#fff' }}>
          + Novo Concurso
        </Link>
      </div>

      {exams.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-sm mb-4" style={{ color: '#8888a0' }}>Nenhum concurso cadastrado ainda.</p>
          <Link href="/exams/new" className="px-4 py-2 rounded-lg text-sm font-medium inline-block" style={{ background: '#6366f1', color: '#fff' }}>
            Adicionar concurso
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {exams.map(exam => {
            const daysLeft = exam.exam_date ? differenceInDays(parseISO(exam.exam_date), new Date()) : null
            return (
              <div key={exam.id} className="rounded-xl border overflow-hidden" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {exam.is_primary && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#1e1e30', color: '#818cf8' }}>
                            ★ Foco principal
                          </span>
                        )}
                        {exam.organization && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#1e1e28', color: '#8888a0' }}>
                            {exam.organization}
                          </span>
                        )}
                        {!exam.exam_date && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#1e1808', color: '#f97316' }}>
                            📂 Pré-edital
                          </span>
                        )}
                      </div>
                      <h2 className="text-base font-semibold" style={{ color: '#e8e8f0' }}>{exam.name}</h2>
                      <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: '#8888a0' }}>
                        <span>{exam.subject_count} matérias</span>
                        {exam.exam_date ? (
                          <span>
                            Prova: {format(parseISO(exam.exam_date), "d MMM yyyy", { locale: ptBR })}
                            {daysLeft !== null && daysLeft >= 0 && (
                              <span className="ml-1" style={{ color: daysLeft < 30 ? '#f87171' : '#8888a0' }}>
                                ({daysLeft}d restantes)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: '#f97316' }}>Sem data definida — edital anterior como referência</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!exam.is_primary && (
                        <button
                          onClick={() => setPrimary(exam.id)}
                          className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:border-indigo-500"
                          style={{ borderColor: '#2a2a38', color: '#8888a0' }}
                        >
                          Definir como foco
                        </button>
                      )}
                      <Link
                        href={`/exams/${exam.id}`}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: '#1e1e30', color: '#818cf8' }}
                      >
                        Ver detalhes
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1">
                    <div className="flex justify-between text-xs" style={{ color: '#8888a0' }}>
                      <span>Progresso geral</span>
                      <span style={{ color: '#e8e8f0' }}>{exam.progress}%</span>
                    </div>
                    <div className="h-2 rounded-full" style={{ background: '#2a2a38' }}>
                      <div
                        className="h-2 rounded-full transition-all duration-500"
                        style={{
                          width: `${exam.progress}%`,
                          background: exam.is_primary ? 'linear-gradient(90deg, #6366f1, #818cf8)' : '#4b5563',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full" style={{ color: '#8888a0' }}>
      <p className="text-sm">Carregando...</p>
    </div>
  )
}
