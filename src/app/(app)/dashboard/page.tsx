'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Exam, Subject, Topic, StudyLog, RevisionSchedule, CalendarPlan, ActivityType, ACTIVITY_LABELS } from '@/lib/types'
import { sm2 } from '@/lib/sm2'
import { getTopicCompletionPercent } from '@/lib/progress'
import { isSupabaseConfigured } from '@/lib/config'
import { format, parseISO, differenceInDays, startOfDay, subDays, isSameDay, eachDayOfInterval, startOfWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Plus, Star, FolderOpen, ClipboardList, RotateCw, Check, ArrowRight, Flame, Clock,
  AlertCircle, CalendarClock, X,
} from 'lucide-react'
import { ActivityIcon, ACTIVITY_ICON_MAP } from '@/lib/activity-icons'

interface DashboardData {
  exams: (Exam & { subject_count: number; progress: number })[]
  todayPlans: (CalendarPlan & { topic: Topic & { subject: Subject } })[]
  dueReviews: (RevisionSchedule & { topic: Topic & { subject: Subject } })[]
  recentLogs: (StudyLog & { topic: Topic & { subject: Subject } })[]
  allLogs: (StudyLog & { topic: Topic & { subject: Subject } })[]
  criticalTopics: (RevisionSchedule & { topic: Topic & { subject: Subject } })[]
  allTopics: (Topic & { subject: Subject })[]
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
      setData({ exams: [], todayPlans: [], dueReviews: [], recentLogs: [], allLogs: [], criticalTopics: [], allTopics: [] })
      setLoading(false)
      return
    }
    try {
    const today = new Date().toISOString().split('T')[0]
    const ninetyDaysAgo = subDays(new Date(), 90).toISOString().split('T')[0]

    const [examsRes, plansRes, reviewsRes, logsRes, allLogsRes, criticalRes, allTopicsRes] = await Promise.all([
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
      supabase.from('study_logs')
        .select('studied_at, duration_minutes, activity_type, topic_id, topic:topics(*, subject:subjects(*))')
        .gte('studied_at', ninetyDaysAgo)
        .order('studied_at', { ascending: false })
        .limit(2000),
      supabase.from('revision_schedule')
        .select('*, topic:topics(*, subject:subjects(*))')
        .lt('ease_factor', 1.7)
        .gt('repetitions', 0)
        .order('ease_factor', { ascending: true })
        .limit(5),
      supabase.from('topics').select('*, subject:subjects(*)'),
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
      allLogs: (allLogsRes.data || []) as any,
      criticalTopics: (criticalRes.data || []) as any,
      allTopics: (allTopicsRes.data || []) as any,
    })
    } catch (e) {
      // Supabase not configured — show empty state
      setData({ exams: [], todayPlans: [], dueReviews: [], recentLogs: [], allLogs: [], criticalTopics: [], allTopics: [] })
    }
    setLoading(false)
  }

  async function togglePlan(planId: string, currentStatus: string) {
    const newStatus = currentStatus === 'done' ? 'planned' : 'done'
    await supabase.from('calendar_plans').update({ status: newStatus }).eq('id', planId)
    loadData()
  }

  const [showQuickLog, setShowQuickLog] = useState(false)

  // Streak (consecutive days with any study log, allowing today to be empty)
  const streak = useMemo(() => {
    if (!data) return 0
    const today = startOfDay(new Date())
    const dayMap = new Set(data.allLogs.map(l => l.studied_at))
    let count = 0
    for (let i = 0; i < 365; i++) {
      const d = subDays(today, i)
      const ds = d.toISOString().split('T')[0]
      if (dayMap.has(ds)) count++
      else if (i > 0) break
    }
    return count
  }, [data])

  // Tempo estudado hoje (em minutos)
  const minutesToday = useMemo(() => {
    if (!data) return 0
    const t = new Date().toISOString().split('T')[0]
    return data.allLogs
      .filter(l => l.studied_at === t)
      .reduce((s, l) => s + (l.duration_minutes || 0), 0)
  }, [data])

  // Tempo por matéria (minutos por subject)
  const subjectTimes = useMemo(() => {
    if (!data) return [] as { subject: Subject; minutes: number }[]
    const map = new Map<string, { subject: Subject; minutes: number }>()
    for (const log of data.allLogs) {
      if (!log.topic?.subject) continue
      const dur = log.duration_minutes || 0
      if (dur === 0) continue
      const s = log.topic.subject
      const cur = map.get(s.id)
      if (cur) cur.minutes += dur
      else map.set(s.id, { subject: s, minutes: dur })
    }
    return [...map.values()].sort((a, b) => b.minutes - a.minutes)
  }, [data])

  // Heatmap das últimas 12 semanas
  const heatmap = useMemo(() => {
    if (!data) return []
    const today = startOfDay(new Date())
    const start = startOfWeek(subDays(today, 7 * 12), { weekStartsOn: 1 })
    const days = eachDayOfInterval({ start, end: today })
    const minutesByDay = new Map<string, number>()
    for (const log of data.allLogs) {
      const key = log.studied_at
      minutesByDay.set(key, (minutesByDay.get(key) || 0) + (log.duration_minutes || 0))
    }
    return days.map(day => ({
      day,
      minutes: minutesByDay.get(day.toISOString().split('T')[0]) || 0,
    }))
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
        <p className="text-sm">Carregando...</p>
      </div>
    )
  }

  const primaryExam = data?.exams.find(e => e.is_primary)
  const otherExams = data?.exams.filter(e => !e.is_primary && !e.is_watching) || []
  const today = new Date()
  const daysToExam = primaryExam?.exam_date
    ? differenceInDays(parseISO(primaryExam.exam_date), today)
    : null

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Dashboard</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {format(today, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick stats pills */}
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg border"
            style={{ background: 'var(--surface)', borderColor: streak >= 7 ? 'var(--warning)' : 'var(--border)' }}
            title="Dias seguidos estudando"
          >
            <Flame size={16} style={{ color: streak > 0 ? 'var(--warning)' : 'var(--text-subtle)' }} fill={streak >= 3 ? 'var(--warning)' : 'transparent'} />
            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
              {streak} {streak === 1 ? 'dia' : 'dias'}
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }} title="Tempo estudado hoje">
            <Clock size={16} style={{ color: minutesToday > 0 ? 'var(--primary)' : 'var(--text-subtle)' }} />
            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
              {Math.floor(minutesToday / 60)}h {minutesToday % 60}min
            </span>
            <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>hoje</span>
          </div>
          <Link
            href="/exams/new"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--primary-strong)', color: '#fff' }}
          >
            <Plus size={14} strokeWidth={2.5} /> Novo Concurso
          </Link>
        </div>
      </div>

      {/* Countdown da prova foco */}
      {primaryExam && daysToExam !== null && daysToExam >= 0 && (
        <div
          className="rounded-2xl p-5 flex items-center gap-5"
          style={{
            background: 'linear-gradient(135deg, var(--primary-strong), var(--primary))',
            color: '#fff',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <CalendarClock size={36} strokeWidth={1.5} />
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider opacity-80">Faltam para a prova de {primaryExam.name}</p>
            <p className="text-3xl font-bold mt-0.5">
              {daysToExam} <span className="text-base font-medium opacity-80">{daysToExam === 1 ? 'dia' : 'dias'}</span>
            </p>
            <p className="text-xs opacity-80 mt-0.5">
              {format(parseISO(primaryExam.exam_date!), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          </div>
        </div>
      )}

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

            {/* Tópicos críticos */}
            {(data?.criticalTopics.length || 0) > 0 && (
              <div className="rounded-xl p-5 border" style={{ background: 'var(--surface)', borderColor: 'var(--danger)' }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium inline-flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                    <AlertCircle size={14} style={{ color: 'var(--danger)' }} /> Tópicos críticos
                  </h3>
                  <Link href="/reviews" className="text-xs" style={{ color: 'var(--primary-strong)' }}>Revisões</Link>
                </div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-subtle)' }}>
                  Tópicos com dificuldade alta que precisam de atenção
                </p>
                <div className="space-y-2">
                  {data?.criticalTopics.slice(0, 3).map(rev => (
                    <div key={rev.id} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--danger-soft)' }}>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: rev.topic?.subject?.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{rev.topic?.name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {rev.topic?.subject?.name} · {rev.repetitions} revisões
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Heatmap de consistência */}
      {data && data.allLogs.length > 0 && (
        <ConsistencyHeatmap days={heatmap} />
      )}

      {/* Pie chart de tempo por matéria */}
      {subjectTimes.length > 0 && (
        <SubjectTimePie subjects={subjectTimes} />
      )}

      {/* FAB Quick Log */}
      {data && data.allTopics.length > 0 && (
        <button
          onClick={() => setShowQuickLog(true)}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center transition-transform hover:scale-110"
          style={{
            background: 'linear-gradient(135deg, var(--primary-strong), var(--primary))',
            color: '#fff',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 40,
          }}
          title="Registrar estudo agora"
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
      )}

      {showQuickLog && data && (
        <QuickLogModal
          topics={data.allTopics}
          onClose={() => setShowQuickLog(false)}
          onSaved={() => { setShowQuickLog(false); loadData() }}
        />
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

// ============== Heatmap ==============
function ConsistencyHeatmap({ days }: { days: { day: Date; minutes: number }[] }) {
  // Build columns of 7 days each (weeks). Order: oldest left, newest right.
  const weeks: { day: Date; minutes: number }[][] = []
  let buf: { day: Date; minutes: number }[] = []
  for (const d of days) {
    buf.push(d)
    if (d.day.getDay() === 0) { weeks.push(buf); buf = [] }
  }
  if (buf.length > 0) weeks.push(buf)

  function color(min: number) {
    if (min === 0) return 'var(--surface-hover)'
    if (min <= 30) return 'color-mix(in srgb, var(--primary) 25%, transparent)'
    if (min <= 60) return 'color-mix(in srgb, var(--primary) 50%, transparent)'
    if (min <= 120) return 'color-mix(in srgb, var(--primary) 75%, transparent)'
    return 'var(--primary-strong)'
  }
  function fmtMin(min: number) {
    if (min === 0) return 'sem estudo'
    const h = Math.floor(min / 60), m = min % 60
    if (h === 0) return `${m}min`
    return m === 0 ? `${h}h` : `${h}h ${m}min`
  }
  const totalMinutes = days.reduce((s, d) => s + d.minutes, 0)
  const studiedDays = days.filter(d => d.minutes > 0).length

  return (
    <div className="rounded-2xl border p-5" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Consistência</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {studiedDays} dias de estudo nas últimas 12 semanas
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
          <span>menos</span>
          {[0, 25, 50, 75, 100].map(level => (
            <div key={level} className="w-3 h-3 rounded-sm" style={{ background: level === 0 ? 'var(--surface-hover)' : level === 100 ? 'var(--primary-strong)' : `color-mix(in srgb, var(--primary) ${level}%, transparent)` }} />
          ))}
          <span>mais</span>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {Array.from({ length: 7 }, (_, di) => {
              // Match by day of week (Monday=1 .. Sunday=0 -> we want Monday top, Sunday bottom)
              const targetDay = (di + 1) % 7  // 1=Mon..6=Sat, 0=Sun
              const cell = week.find(d => d.day.getDay() === targetDay)
              if (!cell) return <div key={di} className="w-3.5 h-3.5 rounded-sm" style={{ background: 'transparent' }} />
              return (
                <div
                  key={di}
                  className="w-3.5 h-3.5 rounded-sm"
                  style={{ background: color(cell.minutes) }}
                  title={`${format(cell.day, "d 'de' MMM", { locale: ptBR })}: ${fmtMin(cell.minutes)}`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============== Pie chart de tempo por matéria ==============
function SubjectTimePie({ subjects }: { subjects: { subject: Subject; minutes: number }[] }) {
  const total = subjects.reduce((s, x) => s + x.minutes, 0)
  if (total === 0) return null
  const size = 200
  const radius = 80
  const cx = size / 2
  const cy = size / 2
  let cumulative = 0
  const slices = subjects.map(({ subject, minutes }) => {
    const start = cumulative
    const end = cumulative + minutes
    cumulative = end
    const startAngle = (start / total) * 2 * Math.PI - Math.PI / 2
    const endAngle = (end / total) * 2 * Math.PI - Math.PI / 2
    const x1 = cx + radius * Math.cos(startAngle)
    const y1 = cy + radius * Math.sin(startAngle)
    const x2 = cx + radius * Math.cos(endAngle)
    const y2 = cy + radius * Math.sin(endAngle)
    const largeArc = end - start > total / 2 ? 1 : 0
    return {
      subject,
      minutes,
      pct: (minutes / total) * 100,
      path: `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`,
    }
  })
  const totalH = Math.floor(total / 60), totalM = total % 60

  return (
    <div className="rounded-2xl border p-5" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="mb-4">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Tempo por matéria</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Distribuição das suas {totalH}h {totalM}min de estudo (últimos 90 dias)
        </p>
      </div>
      <div className="flex items-center gap-6 flex-wrap">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.subject.color} stroke="var(--surface)" strokeWidth={2}>
              <title>{s.subject.name}: {Math.floor(s.minutes / 60)}h {s.minutes % 60}min ({s.pct.toFixed(1)}%)</title>
            </path>
          ))}
          {/* Donut hole */}
          <circle cx={cx} cy={cy} r={42} fill="var(--surface)" />
          <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontSize: '13px', fontWeight: 600, fill: 'var(--text)' }}>{totalH}h</text>
          <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: '10px', fill: 'var(--text-muted)' }}>total</text>
        </svg>
        <div className="flex-1 min-w-0 space-y-1.5">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: s.subject.color }} />
              <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>{s.subject.name}</span>
              <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {Math.floor(s.minutes / 60)}h {s.minutes % 60}min
              </span>
              <span className="tabular-nums w-12 text-right text-xs" style={{ color: 'var(--text-subtle)' }}>
                {s.pct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============== Quick Log Modal ==============
const ACTIVITIES_QL: { type: ActivityType; label: string }[] = [
  { type: 'video', label: 'Videoaula' },
  { type: 'reading', label: 'Leitura' },
  { type: 'exercises', label: 'Exercícios' },
  { type: 'review', label: 'Revisão' },
]

function QuickLogModal({ topics, onClose, onSaved }: {
  topics: (Topic & { subject: Subject })[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [search, setSearch] = useState('')
  const [topicId, setTopicId] = useState<string>('')
  const [activity, setActivity] = useState<ActivityType>('video')
  const [duration, setDuration] = useState('')
  const [total, setTotal] = useState('')
  const [correct, setCorrect] = useState('')
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return topics.slice(0, 12)
    return topics.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.subject?.name.toLowerCase().includes(q)
    ).slice(0, 12)
  }, [topics, search])

  const totalNum = parseInt(total) || 0
  const correctNum = parseInt(correct) || 0
  const canSave = topicId && (activity !== 'exercises' || (totalNum > 0 && correctNum >= 0 && correctNum <= totalNum))

  async function save() {
    if (!canSave) return
    setSaving(true)
    await supabase.from('study_logs').insert({
      topic_id: topicId,
      activity_type: activity,
      duration_minutes: duration ? parseInt(duration) : null,
      total_questions: activity === 'exercises' && totalNum > 0 ? totalNum : null,
      correct_answers: activity === 'exercises' && totalNum > 0 ? correctNum : null,
      studied_at: new Date().toISOString().split('T')[0],
    })

    // Update revision schedule (create if missing)
    const { data: existing } = await supabase.from('revision_schedule').select('*').eq('topic_id', topicId).maybeSingle()
    if (activity === 'exercises' && totalNum > 0) {
      const pct = (correctNum / totalNum) * 100
      const quality = pct >= 95 ? 5 : pct >= 85 ? 4 : pct >= 70 ? 3 : pct >= 50 ? 2 : 1
      const result = sm2(quality, existing?.repetitions ?? 0, existing?.ease_factor ?? 2.5, existing?.interval_days ?? 0)
      if (existing) {
        await supabase.from('revision_schedule').update({ ...result, last_reviewed: new Date().toISOString().split('T')[0] }).eq('id', existing.id)
      } else {
        await supabase.from('revision_schedule').insert({ topic_id: topicId, ...result, last_reviewed: new Date().toISOString().split('T')[0] })
      }
    } else if (!existing) {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
      await supabase.from('revision_schedule').insert({
        topic_id: topicId,
        next_review: tomorrow.toISOString().split('T')[0],
        last_reviewed: new Date().toISOString().split('T')[0],
      })
    }

    setSaving(false)
    onSaved()
  }

  const selectedTopic = topics.find(t => t.id === topicId)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Registrar estudo</h2>
          <button onClick={onClose} style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Topic search */}
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>O que você estudou?</label>
            <input
              type="text"
              placeholder="Buscar tópico..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            {!selectedTopic && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                {filtered.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setTopicId(t.id); setSearch('') }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-hover)] flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: t.subject?.color }} />
                    <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>{t.name}</span>
                    <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>{t.subject?.name}</span>
                  </button>
                ))}
                {filtered.length === 0 && <p className="px-3 py-3 text-xs text-center" style={{ color: 'var(--text-subtle)' }}>Nenhum tópico encontrado</p>}
              </div>
            )}
            {selectedTopic && (
              <div className="mt-2 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: 'var(--primary-soft)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: selectedTopic.subject?.color }} />
                <span className="flex-1 text-sm" style={{ color: 'var(--primary-soft-text)' }}>{selectedTopic.name}</span>
                <button onClick={() => setTopicId('')} style={{ color: 'var(--primary-soft-text)' }}><X size={14} /></button>
              </div>
            )}
          </div>

          {/* Activity */}
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Atividade</label>
            <div className="grid grid-cols-4 gap-1.5">
              {ACTIVITIES_QL.map(a => {
                const Icon = ACTIVITY_ICON_MAP[a.type]
                const active = activity === a.type
                return (
                  <button
                    key={a.type}
                    onClick={() => setActivity(a.type)}
                    className="flex flex-col items-center gap-1 py-2 rounded-lg border transition-all"
                    style={{
                      background: active ? 'var(--primary-soft)' : 'var(--surface-hover)',
                      borderColor: active ? 'var(--primary)' : 'var(--border)',
                      color: active ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                    }}
                  >
                    <Icon size={16} />
                    <span className="text-[11px]">{a.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Exercises fields */}
          {activity === 'exercises' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Total</label>
                <input type="number" min="1" placeholder="50" value={total} onChange={e => setTotal(e.target.value)} />
              </div>
              <div>
                <label className="text-xs block mb-1 inline-flex items-center gap-1" style={{ color: 'var(--success)' }}><Check size={11} strokeWidth={2.5} /> Acertos</label>
                <input type="number" min="0" max={total || undefined} placeholder="40" value={correct} onChange={e => setCorrect(e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Duração (min)</label>
            <input type="number" min="1" placeholder="45" value={duration} onChange={e => setDuration(e.target.value)} />
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--primary-strong)', color: '#fff' }}
          >
            {saving ? 'Salvando...' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
