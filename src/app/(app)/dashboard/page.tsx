'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Exam, Subject, Topic, StudyLog, RevisionSchedule, CalendarPlan } from '@/lib/types'
import { getTopicCompletionPercent } from '@/lib/progress'
import { isSupabaseConfigured } from '@/lib/config'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, Star, FolderOpen, ClipboardList, RotateCw, Check, ArrowRight } from 'lucide-react'
import { ActivityIcon } from '@/lib/activity-icons'

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
        .select('id, completed_at')
        .in('subject_id', subjectIds.length ? subjectIds : ['none'])

      const topicList = topics || []
      const topicIds = topicList.map(t => t.id)

      const { data: logs } = await supabase
        .from('study_logs')
        .select('topic_id, activity_type')
        .in('topic_id', topicIds.length ? topicIds : ['none'])

      const completedByTopic: Record<string, Set<string>> = {}
      for (const log of logs || []) {
        if (!completedByTopic[log.topic_id]) completedByTopic[log.topic_id] = new Set()
        completedByTopic[log.topic_id].add(log.activity_type)
      }

      const totalProgress = topicList.reduce((sum, t) => {
        const acts = [...(completedByTopic[t.id] || [])] as any
        return sum + getTopicCompletionPercent(acts, t.completed_at)
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
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
        <p className="text-sm">Carregando...</p>
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
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Dashboard</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {format(today, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
        </div>
        <Link
          href="/exams/new"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--primary-strong)', color: '#fff' }}
        >
          <Plus size={14} strokeWidth={2.5} /> Novo Concurso
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
              <div className="rounded-xl p-5 border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
                        <Star size={11} fill="currentColor" strokeWidth={0} /> Foco principal
                      </span>
                    </div>
                    <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>{primaryExam.name}</h2>
                    {primaryExam.organization && (
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{primaryExam.organization}</p>
                    )}
                  </div>
                  <Link href={`/exams/${primaryExam.id}`} className="text-sm inline-flex items-center gap-1" style={{ color: 'var(--primary-strong)' }}>
                    Ver detalhes <ArrowRight size={13} />
                  </Link>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span style={{ color: 'var(--text-muted)' }}>{primaryExam.subject_count} matérias</span>
                    <span style={{ color: 'var(--text)' }}>{primaryExam.progress}% concluído</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: 'var(--border)' }}>
                    <div
                      className="h-2 rounded-full transition-all duration-500"
                      style={{ width: `${primaryExam.progress}%`, background: 'linear-gradient(90deg, var(--primary-strong), var(--primary))' }}
                    />
                  </div>
                </div>

                {primaryExam.exam_date ? (
                  <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                    Prova: {format(parseISO(primaryExam.exam_date), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  </p>
                ) : (
                  <p className="text-xs mt-3 flex items-center gap-1.5" style={{ color: 'var(--warning)' }}>
                    <FolderOpen size={12} /> Pré-edital — sem data definida
                  </p>
                )}
              </div>
            )}

            {/* Recent activity */}
            {(data?.recentLogs.length || 0) > 0 && (
              <div className="rounded-xl p-5 border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-muted)' }}>Atividade recente</h3>
                <div className="space-y-3">
                  {data?.recentLogs.map(log => (
                    <div key={log.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                        <ActivityIcon type={log.activity_type} size={15} strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{log.topic?.name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
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
            <div className="rounded-xl p-5 border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Hoje</h3>
                <Link href="/calendar" className="text-xs" style={{ color: 'var(--primary-strong)' }}>Ver calendário</Link>
              </div>
              {(data?.todayPlans.length || 0) === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>Nenhum plano para hoje</p>
                  <Link href="/calendar" className="text-xs mt-1 block" style={{ color: 'var(--primary-strong)' }}>+ Planejar</Link>
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
                          background: plan.status === 'done' ? 'var(--primary-strong)' : 'transparent',
                          borderColor: plan.status === 'done' ? 'var(--primary-strong)' : 'var(--border-strong)',
                        }}
                      >
                        {plan.status === 'done' && <Check size={11} strokeWidth={3} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: plan.status === 'done' ? 'var(--text-subtle)' : 'var(--text)', textDecoration: plan.status === 'done' ? 'line-through' : 'none' }}>
                          {plan.topic?.name}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                          {plan.topic?.subject?.name}
                        </p>
                      </div>
                      <span className="flex-shrink-0" style={{ color: 'var(--text-subtle)' }}>
                        <ActivityIcon type={plan.activity_type} size={13} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Due reviews */}
            {(data?.dueReviews.length || 0) > 0 && (
              <div className="rounded-xl p-5 border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                    Revisões pendentes
                    <span className="ml-2 px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                      {data?.dueReviews.length}
                    </span>
                  </h3>
                  <Link href="/reviews" className="text-xs" style={{ color: 'var(--primary-strong)' }}>Ver todas</Link>
                </div>
                <div className="space-y-2">
                  {data?.dueReviews.slice(0, 4).map(rev => (
                    <div key={rev.id} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--surface-hover)' }}>
                      <RotateCw size={14} style={{ color: 'var(--danger)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{rev.topic?.name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{rev.topic?.subject?.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Other exams */}
            {otherExams.length > 0 && (
              <div className="rounded-xl p-5 border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-muted)' }}>Outros concursos</h3>
                <div className="space-y-1">
                  {otherExams.map(exam => (
                    <Link
                      key={exam.id}
                      href={`/exams/${exam.id}`}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 -mx-2 rounded-md transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <span className="text-sm truncate" style={{ color: 'var(--text)' }}>{exam.name}</span>
                      {exam.progress > 0 ? (
                        <span className="text-xs flex-shrink-0 tabular-nums font-medium" style={{ color: 'var(--text-muted)' }}>{exam.progress}%</span>
                      ) : (
                        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-subtle)' }}>não iniciado</span>
                      )}
                    </Link>
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
      <ClipboardList size={56} strokeWidth={1.25} className="mb-4" style={{ color: 'var(--text-subtle)' }} />
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>Nenhum concurso cadastrado</h2>
      <p className="text-sm mb-6 max-w-xs" style={{ color: 'var(--text-muted)' }}>
        Adicione seu primeiro concurso com o edital em PDF para começar a organizar seus estudos.
      </p>
      <Link
        href="/exams/new"
        className="px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5"
        style={{ background: 'var(--primary-strong)', color: '#fff' }}
      >
        <Plus size={14} strokeWidth={2.5} /> Adicionar primeiro concurso
      </Link>
    </div>
  )
}
