'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Exam, Subject, Topic, StudyLog, RevisionSchedule, CalendarPlan } from '@/lib/types'
import { getTopicCompletionPercent } from '@/lib/progress'
import { isSupabaseConfigured } from '@/lib/config'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface DashboardData {
  exams: (Exam & { subject_count: number; progress: number })[]
  todayPlans: (CalendarPlan & { topic: Topic & { subject: Subject } })[]
  dueReviews: (RevisionSchedule & { topic: Topic & { subject: Subject } })[]
  recentLogs: (StudyLog & { topic: Topic & { subject: Subject } })[]
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    if (!isSupabaseConfigured()) {
      setData({ exams: [], todayPlans: [], dueReviews: [], recentLogs: [] })
      setLoading(false)
      return
    }
    try {
    const today = new Date().toISOString().split('T')[0]

    const [examsRes, plansRes, reviewsRes, logsRes] = await Promise.all([
      supabase.from('exams').select('*').order('is_primary', { ascending: false }).order('created_at'),
      supabase.from('calendar_plans')
        .select('*, topic:topics(*, subject:subjects(*))')
        .eq('planned_date', today)
        .order('order_index'),
      supabase.from('revision_schedule')
        .select('*, topic:topics(*, subject:subjects(*))')
        .lte('next_review', today)
        .order('next_review')
        .limit(10),
      supabase.from('study_logs')
        .select('*, topic:topics(*, subject:subjects(*))')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    // Calculate progress for each exam
    const examsWithProgress = await Promise.all((examsRes.data || []).map(async exam => {
      const { data: examSubjects } = await supabase
        .from('exam_subjects')
        .select('subject_id')
        .eq('exam_id', exam.id)

      const subjectIds = (examSubjects || []).map(es => es.subject_id)

      const { data: topics } = await supabase
        .from('topics')
        .select('id')
        .in('subject_id', subjectIds.length ? subjectIds : ['none'])

      const topicIds = (topics || []).map(t => t.id)

      const { data: logs } = await supabase
        .from('study_logs')
        .select('topic_id, activity_type')
        .in('topic_id', topicIds.length ? topicIds : ['none'])

      const completedByTopic: Record<string, Set<string>> = {}
      for (const log of logs || []) {
        if (!completedByTopic[log.topic_id]) completedByTopic[log.topic_id] = new Set()
        completedByTopic[log.topic_id].add(log.activity_type)
      }

      const totalProgress = topicIds.reduce((sum, id) => {
        const done = completedByTopic[id]?.size || 0
        return sum + getTopicCompletionPercent([...( completedByTopic[id] || [])] as any)
      }, 0)

      return {
        ...exam,
        subject_count: subjectIds.length,
        progress: topicIds.length ? Math.round(totalProgress / topicIds.length) : 0,
      }
    }))

    setData({
      exams: examsWithProgress,
      todayPlans: (plansRes.data || []) as any,
      dueReviews: (reviewsRes.data || []) as any,
      recentLogs: (logsRes.data || []) as any,
    })
    } catch (e) {
      // Supabase not configured — show empty state
      setData({ exams: [], todayPlans: [], dueReviews: [], recentLogs: [] })
    }
    setLoading(false)
  }

  async function togglePlan(planId: string, currentStatus: string) {
    const newStatus = currentStatus === 'done' ? 'planned' : 'done'
    await supabase.from('calendar_plans').update({ status: newStatus }).eq('id', planId)
    loadData()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: '#8888a0' }}>
        <div className="text-center">
          <div className="text-2xl mb-2">⏳</div>
          <p className="text-sm">Carregando...</p>
        </div>
      </div>
    )
  }

  const primaryExam = data?.exams.find(e => e.is_primary)
  const otherExams = data?.exams.filter(e => !e.is_primary) || []
  const today = new Date()

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>Dashboard</h1>
          <p className="text-sm mt-0.5" style={{ color: '#8888a0' }}>
            {format(today, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
        </div>
        <Link
          href="/exams/new"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#6366f1', color: '#fff' }}
        >
          + Novo Concurso
        </Link>
      </div>

      {data?.exams.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Primary exam */}
            {primaryExam && (
              <div className="rounded-xl p-5 border" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#1e1e30', color: '#818cf8' }}>
                        ★ Foco principal
                      </span>
                    </div>
                    <h2 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>{primaryExam.name}</h2>
                    {primaryExam.organization && (
                      <p className="text-sm" style={{ color: '#8888a0' }}>{primaryExam.organization}</p>
                    )}
                  </div>
                  <Link href={`/exams/${primaryExam.id}`} className="text-sm" style={{ color: '#6366f1' }}>
                    Ver detalhes →
                  </Link>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span style={{ color: '#8888a0' }}>{primaryExam.subject_count} matérias</span>
                    <span style={{ color: '#e8e8f0' }}>{primaryExam.progress}% concluído</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: '#2a2a38' }}>
                    <div
                      className="h-2 rounded-full transition-all duration-500"
                      style={{ width: `${primaryExam.progress}%`, background: 'linear-gradient(90deg, #6366f1, #818cf8)' }}
                    />
                  </div>
                </div>

                {primaryExam.exam_date ? (
                  <p className="text-xs mt-3" style={{ color: '#8888a0' }}>
                    Prova: {format(parseISO(primaryExam.exam_date), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  </p>
                ) : (
                  <p className="text-xs mt-3 flex items-center gap-1" style={{ color: '#f97316' }}>
                    <span>📂</span> Pré-edital — sem data definida
                  </p>
                )}
              </div>
            )}

            {/* Other exams */}
            {otherExams.length > 0 && (
              <div className="rounded-xl p-5 border" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
                <h3 className="text-sm font-medium mb-4" style={{ color: '#8888a0' }}>Outros concursos</h3>
                <div className="space-y-4">
                  {otherExams.map(exam => (
                    <Link key={exam.id} href={`/exams/${exam.id}`} className="block group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium group-hover:text-indigo-400 transition-colors" style={{ color: '#e8e8f0' }}>
                          {exam.name}
                        </span>
                        <span className="text-xs" style={{ color: '#8888a0' }}>{exam.progress}%</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: '#2a2a38' }}>
                        <div
                          className="h-1.5 rounded-full"
                          style={{ width: `${exam.progress}%`, background: '#4b5563' }}
                        />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Recent activity */}
            {(data?.recentLogs.length || 0) > 0 && (
              <div className="rounded-xl p-5 border" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
                <h3 className="text-sm font-medium mb-4" style={{ color: '#8888a0' }}>Atividade recente</h3>
                <div className="space-y-3">
                  {data?.recentLogs.map(log => (
                    <div key={log.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style={{ background: '#1e1e28' }}>
                        {log.activity_type === 'video' ? '🎬' : log.activity_type === 'exercises' ? '✏️' : log.activity_type === 'reading' ? '📖' : '🔁'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{log.topic?.name}</p>
                        <p className="text-xs" style={{ color: '#8888a0' }}>
                          {log.topic?.subject?.name} · {format(parseISO(log.studied_at), "d MMM", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Today's plan */}
            <div className="rounded-xl p-5 border" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium" style={{ color: '#8888a0' }}>Hoje</h3>
                <Link href="/calendar" className="text-xs" style={{ color: '#6366f1' }}>Ver calendário</Link>
              </div>
              {(data?.todayPlans.length || 0) === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm" style={{ color: '#555568' }}>Nenhum plano para hoje</p>
                  <Link href="/calendar" className="text-xs mt-1 block" style={{ color: '#6366f1' }}>+ Planejar</Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {data?.todayPlans.map(plan => (
                    <button
                      key={plan.id}
                      onClick={() => togglePlan(plan.id, plan.status)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors hover:bg-white/5"
                    >
                      <div
                        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-all"
                        style={{
                          background: plan.status === 'done' ? '#6366f1' : 'transparent',
                          borderColor: plan.status === 'done' ? '#6366f1' : '#3a3a50',
                        }}
                      >
                        {plan.status === 'done' && <span className="text-xs text-white">✓</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: plan.status === 'done' ? '#555568' : '#e8e8f0', textDecoration: plan.status === 'done' ? 'line-through' : 'none' }}>
                          {plan.topic?.name}
                        </p>
                        <p className="text-xs" style={{ color: '#555568' }}>
                          {plan.topic?.subject?.name}
                        </p>
                      </div>
                      <span className="text-xs flex-shrink-0" style={{ color: '#555568' }}>
                        {plan.activity_type === 'video' ? '🎬' : plan.activity_type === 'exercises' ? '✏️' : plan.activity_type === 'reading' ? '📖' : '🔁'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Due reviews */}
            {(data?.dueReviews.length || 0) > 0 && (
              <div className="rounded-xl p-5 border" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium" style={{ color: '#8888a0' }}>
                    Revisões pendentes
                    <span className="ml-2 px-1.5 py-0.5 rounded text-xs" style={{ background: '#2a1a1a', color: '#f87171' }}>
                      {data?.dueReviews.length}
                    </span>
                  </h3>
                  <Link href="/reviews" className="text-xs" style={{ color: '#6366f1' }}>Ver todas</Link>
                </div>
                <div className="space-y-2">
                  {data?.dueReviews.slice(0, 4).map(rev => (
                    <div key={rev.id} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: '#1e1e28' }}>
                      <span className="text-sm">🔁</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: '#e8e8f0' }}>{rev.topic?.name}</p>
                        <p className="text-xs" style={{ color: '#8888a0' }}>{rev.topic?.subject?.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-5xl mb-4">📋</div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: '#e8e8f0' }}>Nenhum concurso cadastrado</h2>
      <p className="text-sm mb-6 max-w-xs" style={{ color: '#8888a0' }}>
        Adicione seu primeiro concurso com o edital em PDF para começar a organizar seus estudos.
      </p>
      <Link
        href="/exams/new"
        className="px-5 py-2.5 rounded-lg text-sm font-medium"
        style={{ background: '#6366f1', color: '#fff' }}
      >
        + Adicionar primeiro concurso
      </Link>
    </div>
  )
}
