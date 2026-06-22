'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Exam, Subject, Topic, StudyLog, RevisionSchedule, CalendarPlan } from '@/lib/types'
import { getTopicCompletionPercent } from '@/lib/progress'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { useStudyTools } from '@/components/StudyTools'
import { useDataChanged } from '@/lib/events'
import { PageSkeleton } from '@/components/Skeleton'
import { format, parseISO, differenceInDays, startOfDay, subDays, isSameDay, eachDayOfInterval, startOfWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Plus, Star, FolderOpen, ClipboardList, RotateCw, Check, ArrowRight, Flame, Clock,
  AlertCircle, CalendarClock, Timer, Newspaper, ExternalLink,
} from 'lucide-react'
import { ActivityIcon } from '@/lib/activity-icons'
import { GoalsCard } from '@/components/GoalsCard'

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

  // Atualiza quando uma ação global (FAB de registro rápido) muda os dados
  useDataChanged(() => { loadData() })

  async function loadData() {
    if (!isSupabaseConfigured()) {
      setData({ exams: [], todayPlans: [], dueReviews: [], recentLogs: [], allLogs: [], criticalTopics: [], allTopics: [] })
      setLoading(false)
      return
    }
    const userId = await getUserId(supabase)
    if (!userId) {
      setData({ exams: [], todayPlans: [], dueReviews: [], recentLogs: [], allLogs: [], criticalTopics: [], allTopics: [] })
      setLoading(false)
      return
    }
    try {
    const today = new Date().toISOString().split('T')[0]
    const ninetyDaysAgo = subDays(new Date(), 90).toISOString().split('T')[0]

    const [enrollRes, plansRes, reviewsRes, logsRes, allLogsRes, criticalRes, allTopicsRes, topicProgRes] = await Promise.all([
      supabase.from('user_exams')
        .select('is_primary, is_watching, created_at, exam:exams(*)')
        .eq('user_id', userId)
        .order('created_at'),
      supabase.from('calendar_plans')
        .select('*, topic:topics(*, subject:subjects(*))')
        .eq('user_id', userId)
        .eq('planned_date', today)
        .order('order_index'),
      supabase.from('revision_schedule')
        .select('*, topic:topics(*, subject:subjects(*))')
        .eq('user_id', userId)
        .lte('next_review', today)
        .order('next_review')
        .limit(10),
      supabase.from('study_logs')
        .select('*, topic:topics(*, subject:subjects(*))')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.from('study_logs')
        .select('studied_at, duration_minutes, activity_type, topic_id, topic:topics(*, subject:subjects(*))')
        .eq('user_id', userId)
        .gte('studied_at', ninetyDaysAgo)
        .order('studied_at', { ascending: false })
        .limit(2000),
      supabase.from('revision_schedule')
        .select('*, topic:topics(*, subject:subjects(*))')
        .eq('user_id', userId)
        .lt('ease_factor', 1.7)
        .gt('repetitions', 0)
        .order('ease_factor', { ascending: true })
        .limit(5),
      supabase.from('topics').select('*, subject:subjects(*)'),
      supabase.from('user_topic_progress').select('topic_id, completed_at').eq('user_id', userId),
    ])

    const completedTopics = new Set((topicProgRes.data || []).filter((t: any) => t.completed_at).map((t: any) => t.topic_id))
    const enrollments = (enrollRes.data || []).filter((r: any) => r.exam)

    // Calculate progress for each exam (escopado ao usuário)
    const examsWithProgress = await Promise.all(enrollments.map(async (row: any) => {
      const exam = row.exam
      const { data: examSubjects } = await supabase
        .from('exam_subjects')
        .select('subject_id')
        .eq('exam_id', exam.id)

      const subjectIds = (examSubjects || []).map((es: any) => es.subject_id)

      const { data: topics } = await supabase
        .from('topics')
        .select('id')
        .eq('exam_id', exam.id)

      const topicList = topics || []
      const topicIds = topicList.map((t: any) => t.id)

      const { data: logs } = await supabase
        .from('study_logs')
        .select('topic_id, activity_type')
        .eq('user_id', userId)
        .in('topic_id', topicIds.length ? topicIds : ['none'])

      const completedByTopic: Record<string, Set<string>> = {}
      for (const log of logs || []) {
        if (!completedByTopic[log.topic_id]) completedByTopic[log.topic_id] = new Set()
        completedByTopic[log.topic_id].add(log.activity_type)
      }

      const totalProgress = topicList.reduce((sum: number, t: any) => {
        const acts = [...(completedByTopic[t.id] || [])] as any
        return sum + getTopicCompletionPercent(acts, completedTopics.has(t.id) ? '1' : null)
      }, 0)

      return {
        ...exam,
        is_primary: row.is_primary,
        is_watching: row.is_watching,
        subject_count: subjectIds.length,
        progress: topicIds.length ? Math.round(totalProgress / topicIds.length) : 0,
      }
    }))
    examsWithProgress.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))

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

  const { pomodoroOpen, openPomodoro } = useStudyTools()
  const [relatedNews, setRelatedNews] = useState<{ title: string; link: string; source: string; pubDate: string }[]>([])

  // Fetch news once and filter by exam organizations
  useEffect(() => {
    if (!data || data.exams.length === 0) return
    const orgs = data.exams
      .filter(e => !e.is_watching && e.organization)
      .map(e => (e.organization as string).toLowerCase())
      .concat(data.exams.filter(e => !e.is_watching).map(e => e.name.toLowerCase()))
    if (orgs.length === 0) return
    fetch('/api/news').then(r => r.json()).then(d => {
      if (!d.items) return
      const matches = (d.items as any[]).filter(item => {
        const hay = (item.title + ' ' + item.description).toLowerCase()
        return orgs.some(o => o && o.length >= 3 && hay.includes(o))
      })
      setRelatedNews(matches.slice(0, 3))
    }).catch(() => {})
  }, [data?.exams.length])

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

  // Próximas provas — todos os concursos com data >= hoje, ordenados
  const upcomingExams = useMemo(() => {
    if (!data) return []
    const today = new Date()
    return data.exams
      .filter(e => e.exam_date && !e.is_watching && differenceInDays(parseISO(e.exam_date), today) >= 0)
      .sort((a, b) => parseISO(a.exam_date!).getTime() - parseISO(b.exam_date!).getTime())
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
    return <PageSkeleton variant="default" />
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
          <button
            onClick={openPomodoro}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors"
            style={{
              background: pomodoroOpen ? 'var(--primary-soft)' : 'var(--surface)',
              borderColor: pomodoroOpen ? 'var(--primary)' : 'var(--border)',
              color: pomodoroOpen ? 'var(--primary-soft-text)' : 'var(--text-muted)',
            }}
            title="Pomodoro timer"
          >
            <Timer size={14} /> Pomodoro
          </button>
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

      {/* Próximas provas (todos os concursos com data, ordenados) */}
      {upcomingExams.length > 1 && (
        <div className="ef-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock size={14} style={{ color: 'var(--text-muted)' }} />
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Próximas provas</h3>
          </div>
          <div className="space-y-1">
            {upcomingExams.map(exam => {
              const days = differenceInDays(parseISO(exam.exam_date!), today)
              return (
                <Link
                  key={exam.id}
                  href={`/exams/${exam.id}`}
                  className="flex items-center justify-between gap-3 px-2 py-2 -mx-2 rounded-md transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {exam.is_primary && <Star size={12} fill="currentColor" strokeWidth={0} style={{ color: 'var(--primary)' }} />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{exam.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                        {format(parseISO(exam.exam_date!), "d 'de' MMM 'de' yyyy", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                  <span
                    className="text-xs font-semibold tabular-nums px-2 py-1 rounded-md flex-shrink-0"
                    style={{
                      background: days < 30 ? 'var(--danger-soft)' : days < 90 ? 'var(--warning-soft)' : 'var(--primary-soft)',
                      color: days < 30 ? 'var(--danger)' : days < 90 ? 'var(--warning)' : 'var(--primary-soft-text)',
                    }}
                  >
                    {days}d
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {data?.exams.length === 0 ? (
        <EmptyState />
      ) : (
        <>
        <GoalsCard />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Primary exam */}
            {primaryExam && (
              <div className="ef-card p-5">
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
              <div className="ef-card p-5">
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

            {/* Horas por dia (no lado esquerdo para equilibrar a altura) */}
            {data && data.allLogs.length > 0 && (
              <HoursPerDayChart days={heatmap} />
            )}
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Today's plan */}
            <div className="ef-card p-5">
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
                      className="w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors hover:bg-[var(--surface-hover)]"
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
              <div className="ef-card p-5">
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
              <div className="ef-card p-5">
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
              <div className="ef-card p-5" style={{ borderColor: 'var(--danger)' }}>
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
        </>
      )}

      {/* Notícias relacionadas */}
      {relatedNews.length > 0 && (
        <div className="ef-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Newspaper size={15} style={{ color: 'var(--primary)' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Notícias dos seus concursos</h3>
            </div>
            <Link href="/news" className="text-xs" style={{ color: 'var(--primary-strong)' }}>Ver todas</Link>
          </div>
          <div className="space-y-2">
            {relatedNews.map((n, i) => (
              <a
                key={i}
                href={n.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 rounded-lg transition-colors hover:bg-[var(--surface-hover)]"
                style={{ background: 'var(--surface-hover)' }}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{n.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>
                      {n.source}
                    </p>
                  </div>
                  <ExternalLink size={13} style={{ color: 'var(--text-subtle)' }} className="flex-shrink-0 mt-0.5" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Pie chart de tempo por matéria */}
      {subjectTimes.length > 0 && (
        <SubjectTimePie subjects={subjectTimes} />
      )}

    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
        <ClipboardList size={30} strokeWidth={1.5} />
      </div>
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

// ============== Hours per day bar chart ==============
function HoursPerDayChart({ days }: { days: { day: Date; minutes: number }[] }) {
  // Show last 14 days
  const recent = days.slice(-14)
  const maxMinutes = Math.max(60, ...recent.map(d => d.minutes))
  const total = recent.reduce((s, d) => s + d.minutes, 0)
  const studied = recent.filter(d => d.minutes > 0).length
  const avg = studied > 0 ? Math.round(total / studied) : 0

  function fmtH(min: number) {
    const h = Math.floor(min / 60), m = min % 60
    if (h === 0 && m === 0) return '0'
    if (h === 0) return `${m}min`
    if (m === 0) return `${h}h`
    return `${h}h${m}`
  }

  return (
    <div className="ef-card p-5">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Horas estudadas por dia</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Últimos 14 dias · {studied} {studied === 1 ? 'dia ativo' : 'dias ativos'} · média de {fmtH(avg)} nos dias estudados
          </p>
        </div>
      </div>

      <div className="flex items-end gap-1.5" style={{ height: 140 }}>
        {recent.map(({ day, minutes }, i) => {
          const heightPct = maxMinutes > 0 ? (minutes / maxMinutes) * 100 : 0
          const today = isSameDay(day, new Date())
          return (
            <div key={i} className="flex-1 min-w-0 flex flex-col items-center justify-end group relative">
              {minutes > 0 && (
                <span
                  className="absolute -top-5 text-[10px] font-semibold tabular-nums opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                  style={{ color: 'var(--text)' }}
                >
                  {fmtH(minutes)}
                </span>
              )}
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height: minutes > 0 ? `${Math.max(heightPct, 6)}%` : '3px',
                  background: minutes > 0
                    ? (today ? 'linear-gradient(180deg, var(--primary), var(--primary-strong))' : 'var(--primary)')
                    : 'var(--border)',
                  opacity: minutes === 0 ? 0.5 : 1,
                }}
                title={`${format(day, "EEEE, d 'de' MMM", { locale: ptBR })}: ${fmtH(minutes)}`}
              />
            </div>
          )
        })}
      </div>

      {/* x-axis labels */}
      <div className="flex items-center gap-1.5 mt-2">
        {recent.map(({ day }, i) => {
          const today = isSameDay(day, new Date())
          return (
            <div key={i} className="flex-1 min-w-0 text-center">
              <p
                className="text-[10px] uppercase font-medium"
                style={{ color: today ? 'var(--primary)' : 'var(--text-subtle)' }}
              >
                {format(day, 'EEEEEE', { locale: ptBR })}
              </p>
              <p className="text-[10px] tabular-nums" style={{ color: today ? 'var(--primary)' : 'var(--text-subtle)' }}>
                {format(day, 'd')}
              </p>
            </div>
          )
        })}
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
    <div className="ef-card p-5">
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

