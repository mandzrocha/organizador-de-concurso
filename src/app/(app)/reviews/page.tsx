'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { RevisionSchedule, Topic, Subject, ActivityType, StudyLog } from '@/lib/types'
import { sm2 } from '@/lib/sm2'
import { isSupabaseConfigured } from '@/lib/config'
import { format, parseISO, differenceInDays, addDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle, AlertCircle, PartyPopper, RotateCw, Clock, ArrowRight, ArrowLeft, Check } from 'lucide-react'
import { ActivityIcon } from '@/lib/activity-icons'

type RevWithTopic = RevisionSchedule & { topic: Topic & { subject: Subject; exams?: { name: string; is_primary: boolean }[] } }
type Tab = 'pending' | 'upcoming' | 'history' | 'stats'

const QUALITY_OPTIONS = [
  { value: 5, label: 'Fácil demais',   color: 'var(--success)', desc: 'Lembrei sem esforço, posso espaçar mais' },
  { value: 4, label: 'Bom',            color: '#84cc16',        desc: 'Lembrei bem, com leve esforço' },
  { value: 3, label: 'Regular',        color: '#eab308',        desc: 'Lembrei com bastante esforço' },
  { value: 2, label: 'Difícil',        color: 'var(--warning)', desc: 'Esqueci a maior parte' },
  { value: 1, label: 'Muito difícil',  color: 'var(--danger)',  desc: 'Não lembrei quase nada — preciso revisar do zero' },
]

/**
 * Translates the SM-2 ease_factor into a human-readable DIFFICULTY label.
 * Higher ease_factor = easier topic = LOWER difficulty.
 * Returns null when the topic has never been reviewed yet (no data to assess).
 */
function difficultyLabel(ef: number, repetitions: number): { label: string; color: string } | null {
  if (repetitions === 0) return null
  if (ef >= 2.5) return { label: 'Baixa',   color: 'var(--success)' }
  if (ef >= 2.0) return { label: 'Média',   color: '#84cc16' }
  if (ef >= 1.7) return { label: 'Alta',    color: 'var(--warning)' }
  return                  { label: 'Crítica', color: 'var(--danger)' }
}

const EXERCISE_THRESHOLD = 85

/**
 * Maps an exercise/question accuracy percentage to an SM-2 quality (1-5).
 * The 85% line is the pass mark: >= 85% yields quality >= 4 (longer interval),
 * below 85% yields quality <= 3 (shorter interval / reset).
 */
function getExerciseQuality(pct: number): number {
  if (pct >= 95) return 5
  if (pct >= EXERCISE_THRESHOLD) return 4
  if (pct >= 70) return 3
  if (pct >= 50) return 2
  return 1
}

const REVIEW_TYPES: { type: ActivityType; label: string; desc: string }[] = [
  { type: 'exercises', label: 'Questões / Exercícios', desc: 'Resolvi questões sobre o tópico' },
  { type: 'video',     label: 'Videoaula',             desc: 'Reassisti a aula ou um resumo em vídeo' },
  { type: 'reading',   label: 'Leitura',               desc: 'Reli a teoria, resumo ou anotações' },
  { type: 'review',    label: 'Revisão livre',         desc: 'Recordei de cabeça, sem material' },
]

export default function ReviewsPage() {
  const supabase = createClient()
  const [allReviews, setAllReviews] = useState<RevWithTopic[]>([])
  const [recentReviews, setRecentReviews] = useState<(StudyLog & { topic: Topic & { subject: Subject } })[]>([])
  const [loading, setLoading] = useState(true)
  const [doing, setDoing] = useState<RevWithTopic | null>(null)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [subjectFilter, setSubjectFilter] = useState<string>('all')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const [revRes, logsRes] = await Promise.all([
      supabase.from('revision_schedule')
        .select('*, topic:topics(*, subject:subjects(*))')
        .order('next_review', { ascending: true })
        .limit(500),
      supabase.from('study_logs')
        .select('*, topic:topics(*, subject:subjects(*))')
        .eq('activity_type', 'review')
        .order('studied_at', { ascending: false })
        .limit(40),
    ])
    setAllReviews((revRes.data || []) as RevWithTopic[])
    setRecentReviews((logsRes.data || []) as any)
    setLoading(false)
  }

  async function submitReview(payload: {
    quality: number
    activityType: ActivityType
    totalQuestions?: number | null
    correctAnswers?: number | null
    durationMinutes?: number | null
    notes?: string | null
  }) {
    if (!doing) return
    setSaving(true)
    const result = sm2(payload.quality, doing.repetitions, doing.ease_factor, doing.interval_days)
    await supabase.from('revision_schedule').update({
      ...result,
      last_reviewed: new Date().toISOString().split('T')[0],
    }).eq('id', doing.id)
    await supabase.from('study_logs').insert({
      topic_id: doing.topic_id,
      // The session is always logged as a review; the modality (videoaula, questões, etc.)
      // is stored in notes so the review history keeps showing it.
      activity_type: 'review' as ActivityType,
      studied_at: new Date().toISOString().split('T')[0],
      total_questions: payload.totalQuestions ?? null,
      correct_answers: payload.correctAnswers ?? null,
      duration_minutes: payload.durationMinutes ?? null,
      notes: payload.notes ?? null,
    })
    setSaving(false)
    setDoing(null)
    loadAll()
  }

  async function postpone(reviewId: string, days: number) {
    const current = allReviews.find(r => r.id === reviewId)
    if (!current) return
    const base = current.next_review ? parseISO(current.next_review) : new Date()
    const next = addDays(base, days)
    await supabase.from('revision_schedule').update({
      next_review: next.toISOString().split('T')[0],
    }).eq('id', reviewId)
    loadAll()
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split('T')[0]

  const { overdue, dueToday, upcoming, all } = useMemo(() => {
    const filtered = subjectFilter === 'all'
      ? allReviews
      : allReviews.filter(r => r.topic?.subject?.id === subjectFilter)

    const overdue: RevWithTopic[] = []
    const dueToday: RevWithTopic[] = []
    const upcoming: RevWithTopic[] = []

    for (const r of filtered) {
      if (!r.next_review) continue
      const days = differenceInDays(parseISO(r.next_review), today)
      if (days < 0) overdue.push(r)
      else if (days === 0) dueToday.push(r)
      else upcoming.push(r)
    }
    return { overdue, dueToday, upcoming, all: filtered }
  }, [allReviews, subjectFilter, todayStr])

  const subjects = useMemo(() => {
    const map = new Map<string, Subject>()
    for (const r of allReviews) {
      if (r.topic?.subject) map.set(r.topic.subject.id, r.topic.subject)
    }
    return [...map.values()]
  }, [allReviews])

  // Stats
  const stats = useMemo(() => {
    const total = allReviews.length
    // Only count topics that have actually been reviewed (repetitions > 0)
    const reviewed = allReviews.filter(r => r.repetitions > 0)
    const struggling = reviewed.filter(r => r.ease_factor < 1.7)
    const mastered = reviewed.filter(r => r.repetitions >= 5 && r.ease_factor >= 2.5)
    const avgInterval = allReviews.length ? Math.round(allReviews.reduce((s, r) => s + r.interval_days, 0) / allReviews.length) : 0
    const reviewedThisWeek = recentReviews.filter(l => differenceInDays(today, parseISO(l.studied_at)) <= 7).length
    return { total, struggling, mastered, avgInterval, reviewedThisWeek }
  }, [allReviews, recentReviews, today])

  if (loading) return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}><p className="text-sm">Carregando...</p></div>

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Revisões</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Sistema de repetição espaçada (SM-2)</p>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Em atraso" value={overdue.length} color="var(--danger)" soft="var(--danger-soft)" onClick={() => setTab('pending')} />
        <StatCard label="Hoje" value={dueToday.length} color="var(--warning)" soft="var(--warning-soft)" onClick={() => setTab('pending')} />
        <StatCard label="Próximas" value={upcoming.length} color="var(--primary)" soft="var(--primary-soft)" onClick={() => setTab('upcoming')} />
        <StatCard label="Total ativo" value={all.length} color="var(--text-muted)" soft="var(--surface-hover)" />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {([
          { key: 'pending'  as const, label: `Para revisar (${overdue.length + dueToday.length})` },
          { key: 'upcoming' as const, label: `Próximas (${upcoming.length})` },
          { key: 'history'  as const, label: `Histórico (${recentReviews.length})` },
          { key: 'stats'    as const, label: 'Estatísticas' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{
              color: tab === t.key ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: tab === t.key ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Subject filter */}
      {subjects.length > 1 && tab !== 'stats' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Filtrar:</span>
          <button
            onClick={() => setSubjectFilter('all')}
            className="text-xs px-2.5 py-1 rounded-md border"
            style={{
              background: subjectFilter === 'all' ? 'var(--primary-soft)' : 'transparent',
              borderColor: subjectFilter === 'all' ? 'var(--primary)' : 'var(--border)',
              color: subjectFilter === 'all' ? 'var(--primary-soft-text)' : 'var(--text-muted)',
            }}
          >
            Todas
          </button>
          {subjects.map(s => (
            <button
              key={s.id}
              onClick={() => setSubjectFilter(s.id)}
              className="text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5"
              style={{
                background: subjectFilter === s.id ? 'var(--primary-soft)' : 'transparent',
                borderColor: subjectFilter === s.id ? 'var(--primary)' : 'var(--border)',
                color: subjectFilter === s.id ? 'var(--primary-soft-text)' : 'var(--text-muted)',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Tab: Pending */}
      {tab === 'pending' && (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--danger)' }}>
                <AlertTriangle size={15} /> Em atraso
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'var(--danger-soft)' }}>{overdue.length}</span>
              </h3>
              <div className="space-y-2">
                {overdue.map(rev => <ReviewRow key={rev.id} rev={rev} status="overdue" onStart={() => setDoing(rev)} onPostpone={(d) => postpone(rev.id, d)} />)}
              </div>
            </section>
          )}

          {dueToday.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--warning)' }}>
                <Clock size={15} /> Para hoje
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'var(--warning-soft)' }}>{dueToday.length}</span>
              </h3>
              <div className="space-y-2">
                {dueToday.map(rev => <ReviewRow key={rev.id} rev={rev} status="today" onStart={() => setDoing(rev)} onPostpone={(d) => postpone(rev.id, d)} />)}
              </div>
            </section>
          )}

          {overdue.length === 0 && dueToday.length === 0 && (
            <div className="rounded-2xl border p-10 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <PartyPopper size={40} strokeWidth={1.5} className="mx-auto mb-2" style={{ color: 'var(--success)' }} />
              <p className="text-base font-semibold" style={{ color: 'var(--text)' }}>Nenhuma revisão pendente!</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Você está em dia. Continue estudando para criar novas revisões.</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Upcoming */}
      {tab === 'upcoming' && (
        <div className="space-y-2">
          {upcoming.length === 0 ? (
            <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>Nenhuma revisão futura agendada.</p>
            </div>
          ) : (
            upcoming.map(rev => <ReviewRow key={rev.id} rev={rev} status="upcoming" onStart={() => setDoing(rev)} onPostpone={(d) => postpone(rev.id, d)} />)
          )}
        </div>
      )}

      {/* Tab: History */}
      {tab === 'history' && (
        <div className="space-y-2">
          {recentReviews.length === 0 ? (
            <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>Nenhuma revisão feita ainda.</p>
            </div>
          ) : (
            recentReviews.map(log => (
              <div key={log.id} className="rounded-xl border p-3 flex items-center gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><RotateCw size={16} /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{log.topic?.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
                    {log.topic?.subject && (
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: log.topic.subject.color }} />
                        {log.topic.subject.name}
                      </span>
                    )}
                    {log.notes && <span>· {log.notes}</span>}
                    <span>· {format(parseISO(log.studied_at), "d 'de' MMM yyyy", { locale: ptBR })}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Stats */}
      {tab === 'stats' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Tópicos em revisão</p>
              <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{stats.total}</p>
            </div>
            <div className="rounded-xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Revisões nesta semana</p>
              <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{stats.reviewedThisWeek}</p>
            </div>
            <div className="rounded-xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Intervalo médio</p>
              <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{stats.avgInterval} dias</p>
            </div>
            <div className="rounded-xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Bem fixados</p>
              <p className="text-2xl font-bold mt-1" style={{ color: 'var(--success)' }}>{stats.mastered.length}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>5+ revisões com dificuldade baixa</p>
            </div>
          </div>

          {/* Struggling topics */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <AlertCircle size={15} style={{ color: 'var(--danger)' }} /> Tópicos com dificuldade
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{stats.struggling.length}</span>
            </h3>
            {stats.struggling.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>Nenhum tópico com dificuldade no momento.</p>
            ) : (
              <div className="space-y-2">
                {stats.struggling.map(rev => {
                  const d = difficultyLabel(rev.ease_factor, rev.repetitions)
                  return (
                  <div key={rev.id} className="rounded-xl border p-3 flex items-center gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--danger)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{rev.topic?.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {rev.topic?.subject?.name}{d ? ` · Dificuldade ${d.label}` : ''} · {rev.repetitions} revisões
                      </p>
                    </div>
                    <button
                      onClick={() => setDoing(rev)}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}
                    >
                      Revisar agora
                    </button>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal */}
      {doing && <ReviewModal rev={doing} saving={saving} onCancel={() => setDoing(null)} onSubmit={submitReview} />}
    </div>
  )
}

function StatCard({ label, value, color, soft, onClick }: { label: string; value: number; color: string; soft: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="rounded-xl border p-4 text-left transition-all"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', cursor: onClick ? 'pointer' : 'default' }}
    >
      <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: value > 0 ? color : 'var(--text-subtle)' }}>{value}</p>
    </button>
  )
}

function ReviewRow({ rev, status, onStart, onPostpone }: {
  rev: RevWithTopic
  status: 'overdue' | 'today' | 'upcoming'
  onStart: () => void
  onPostpone: (days: number) => void
}) {
  const difficulty = difficultyLabel(rev.ease_factor, rev.repetitions)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = rev.next_review ? differenceInDays(parseISO(rev.next_review), today) : 0
  const lastDays = rev.last_reviewed ? differenceInDays(today, parseISO(rev.last_reviewed)) : null

  const [postponeOpen, setPostponeOpen] = useState(false)
  const postponeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!postponeOpen) return
    function onDown(e: MouseEvent) {
      if (postponeRef.current && !postponeRef.current.contains(e.target as Node)) setPostponeOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [postponeOpen])

  const statusColor =
    status === 'overdue' ? 'var(--danger)' :
    status === 'today'   ? 'var(--warning)' :
    'var(--text-muted)'
  const statusBg =
    status === 'overdue' ? 'var(--danger-soft)' :
    status === 'today'   ? 'var(--warning-soft)' :
    'transparent'
  const statusText =
    status === 'overdue' ? `${Math.abs(days)}d em atraso` :
    status === 'today'   ? 'Para hoje' :
    `em ${days} ${days === 1 ? 'dia' : 'dias'}`

  return (
    <div
      className="rounded-xl border flex items-center gap-3 px-4 py-3 transition-colors"
      style={{
        background: 'var(--surface)',
        borderColor: status === 'overdue' ? 'var(--danger)' : 'var(--border)',
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{rev.topic?.name}</p>
          <span
            className="text-xs px-1.5 py-0.5 rounded-md font-medium"
            style={{ background: statusBg, color: statusColor }}
          >
            {statusText}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
          {rev.topic?.subject && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: rev.topic.subject.color }} />
              {rev.topic.subject.name}
            </span>
          )}
          {difficulty && (
            <>
              <span>·</span>
              <span style={{ color: difficulty.color }}>Dificuldade: {difficulty.label}</span>
            </>
          )}
          <span>·</span>
          <span>{rev.repetitions} {rev.repetitions === 1 ? 'revisão' : 'revisões'}</span>
          {lastDays !== null && (
            <>
              <span>·</span>
              <span>Última há {lastDays}d</span>
            </>
          )}
          <span>·</span>
          <span>Próxima: {rev.next_review ? format(parseISO(rev.next_review), "d MMM", { locale: ptBR }) : '—'}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="relative" ref={postponeRef}>
          <button
            onClick={() => setPostponeOpen(o => !o)}
            className="text-xs px-2.5 py-1.5 rounded-lg border transition-colors inline-flex items-center gap-1.5"
            style={{
              borderColor: postponeOpen ? 'var(--primary)' : 'var(--border)',
              color: postponeOpen ? 'var(--primary)' : 'var(--text-muted)',
            }}
            title="Adiar revisão"
          >
            <Clock size={12} /> Adiar
          </button>
          {postponeOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-20 w-40 rounded-xl border overflow-hidden"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}
            >
              {[
                { d: 1, label: '+ 1 dia' },
                { d: 3, label: '+ 3 dias' },
                { d: 7, label: '+ 1 semana' },
                { d: 14, label: '+ 2 semanas' },
              ].map(opt => (
                <button
                  key={opt.d}
                  onClick={() => { onPostpone(opt.d); setPostponeOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--surface-hover)]"
                  style={{ color: 'var(--text)' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onStart}
          className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1"
          style={{ background: 'var(--primary-strong)', color: '#fff' }}
        >
          Revisar <ArrowRight size={12} />
        </button>
      </div>
    </div>
  )
}

function ReviewModal({ rev, saving, onCancel, onSubmit }: {
  rev: RevWithTopic
  saving: boolean
  onCancel: () => void
  onSubmit: (payload: { quality: number; activityType: ActivityType; totalQuestions?: number | null; correctAnswers?: number | null; durationMinutes?: number | null; notes?: string | null }) => void
}) {
  const difficulty = difficultyLabel(rev.ease_factor, rev.repetitions)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const lastDays = rev.last_reviewed ? differenceInDays(today, parseISO(rev.last_reviewed)) : null

  // Two-phase flow: 1) pick the review modality, 2) register the result.
  const [type, setType] = useState<ActivityType | null>(null)
  const [correct, setCorrect] = useState('')
  const [total, setTotal] = useState('')
  const [duration, setDuration] = useState('')

  const typeMeta = REVIEW_TYPES.find(t => t.type === type)

  const durationNum = parseInt(duration, 10)
  const durationMinutes = !isNaN(durationNum) && durationNum > 0 ? durationNum : null

  // Exercise math
  const correctNum = parseInt(correct, 10)
  const totalNum = parseInt(total, 10)
  const validExercise = !isNaN(correctNum) && !isNaN(totalNum) && totalNum > 0 && correctNum >= 0 && correctNum <= totalNum
  const pct = validExercise ? Math.round((correctNum / totalNum) * 100) : 0
  const exerciseQuality = validExercise ? getExerciseQuality(pct) : 0
  const passed = pct >= EXERCISE_THRESHOLD

  function submitExercise() {
    if (!validExercise || saving) return
    onSubmit({
      quality: exerciseQuality,
      activityType: 'exercises',
      totalQuestions: totalNum,
      correctAnswers: correctNum,
      durationMinutes,
      notes: `Questões: ${correctNum}/${totalNum} (${pct}%)`,
    })
  }

  function submitQuality(quality: number) {
    if (saving || !type) return
    onSubmit({
      quality,
      activityType: type,
      durationMinutes,
      notes: typeMeta ? `${typeMeta.label}` : null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="w-full max-w-lg rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs mb-0.5 inline-flex items-center gap-1.5" style={{ color: 'var(--primary)' }}><RotateCw size={11} /> Revisar</p>
          <h2 className="text-lg font-semibold leading-tight" style={{ color: 'var(--text)' }}>{rev.topic?.name}</h2>
          <div className="flex items-center gap-3 mt-2 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
            {rev.topic?.subject && (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: rev.topic.subject.color }} />
                {rev.topic.subject.name}
              </span>
            )}
            <span>·</span>
            <span>{rev.repetitions} {rev.repetitions === 1 ? 'revisão' : 'revisões'}</span>
            <span>·</span>
            <span>Intervalo atual: {rev.interval_days} {rev.interval_days === 1 ? 'dia' : 'dias'}</span>
            {difficulty && (
              <>
                <span>·</span>
                <span style={{ color: difficulty.color }}>Dificuldade: {difficulty.label}</span>
              </>
            )}
          </div>
          {lastDays !== null && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>
              Última revisão há {lastDays} {lastDays === 1 ? 'dia' : 'dias'}
              {rev.last_reviewed && ` (${format(parseISO(rev.last_reviewed), "d 'de' MMM", { locale: ptBR })})`}
            </p>
          )}
        </div>

        {/* Step 1 — choose review type */}
        {!type && (
          <div className="p-5 space-y-3">
            <div className="p-3 rounded-xl text-sm" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
              <p className="font-medium mb-0.5" style={{ color: 'var(--text)' }}>Como você revisou este tópico?</p>
              <p className="text-xs">Escolha o tipo de revisão para registrar.</p>
            </div>
            <div className="space-y-2">
              {REVIEW_TYPES.map(t => (
                <button
                  key={t.type}
                  onClick={() => setType(t.type)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all hover:border-[var(--primary)]"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-hover)' }}
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
                    <ActivityIcon type={t.type} size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{t.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.desc}</p>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--text-subtle)' }} />
                </button>
              ))}
            </div>
            <button onClick={onCancel} className="w-full text-sm py-2" style={{ color: 'var(--text-subtle)' }}>Cancelar</button>
          </div>
        )}

        {/* Step 2a — exercises: register correct/total */}
        {type === 'exercises' && (
          <div className="p-5 space-y-4">
            <button onClick={() => setType(null)} className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              <ArrowLeft size={12} /> Trocar tipo
            </button>
            <div>
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--text)' }}>Quantas questões você acertou?</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Acertos</label>
                  <input
                    type="number" min={0} value={correct} onChange={e => setCorrect(e.target.value)} autoFocus
                    className="w-full px-3 py-2 rounded-lg border text-sm" style={{ background: 'var(--surface-hover)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Total de questões</label>
                  <input
                    type="number" min={1} value={total} onChange={e => setTotal(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm" style={{ background: 'var(--surface-hover)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Tempo de estudo (min) <span style={{ color: 'var(--text-subtle)' }}>· opcional</span></label>
              <input
                type="number" min={0} value={duration} onChange={e => setDuration(e.target.value)} placeholder="ex: 30"
                className="w-full px-3 py-2 rounded-lg border text-sm" style={{ background: 'var(--surface-hover)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </div>

            {validExercise && (
              <div className="p-3 rounded-xl flex items-center gap-3" style={{ background: passed ? 'var(--success-soft)' : 'var(--warning-soft)' }}>
                <div className="text-2xl font-bold" style={{ color: passed ? 'var(--success)' : 'var(--warning)' }}>{pct}%</div>
                <div className="flex-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {passed ? (
                    <p><span className="font-medium" style={{ color: 'var(--text)' }}>Acima de {EXERCISE_THRESHOLD}%.</span> Conteúdo bem fixado — a próxima revisão será espaçada para mais longe.</p>
                  ) : (
                    <p><span className="font-medium" style={{ color: 'var(--text)' }}>Abaixo de {EXERCISE_THRESHOLD}%.</span> Precisa reforçar — a próxima revisão virá em breve.</p>
                  )}
                  <p className="mt-0.5">Próxima revisão em <span className="font-medium" style={{ color: 'var(--text)' }}>{sm2(exerciseQuality, rev.repetitions, rev.ease_factor, rev.interval_days).interval_days} dias</span></p>
                </div>
              </div>
            )}

            <button
              onClick={submitExercise}
              disabled={!validExercise || saving}
              className="w-full py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: 'var(--primary-strong)', color: '#fff' }}
            >
              <Check size={15} /> {saving ? 'Salvando...' : 'Registrar revisão'}
            </button>
          </div>
        )}

        {/* Step 2b — non-exercise types: subjective quality */}
        {type && type !== 'exercises' && (
          <div className="p-5 space-y-3">
            <button onClick={() => setType(null)} className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              <ArrowLeft size={12} /> Trocar tipo
            </button>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Tempo de estudo (min) <span style={{ color: 'var(--text-subtle)' }}>· opcional</span></label>
              <input
                type="number" min={0} value={duration} onChange={e => setDuration(e.target.value)} placeholder="ex: 30"
                className="w-full px-3 py-2 rounded-lg border text-sm" style={{ background: 'var(--surface-hover)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </div>

            <div className="p-3 rounded-xl text-sm" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
              <p className="font-medium mb-0.5" style={{ color: 'var(--text)' }}>Como foi lembrar deste tópico?</p>
              <p className="text-xs">Achou fácil → a próxima revisão será mais espaçada. Achou difícil → virá mais cedo.</p>
            </div>

            <div className="space-y-2">
              {QUALITY_OPTIONS.map(opt => {
                const nextResult = sm2(opt.value, rev.repetitions, rev.ease_factor, rev.interval_days)
                return (
                  <button
                    key={opt.value}
                    onClick={() => submitQuality(opt.value)}
                    disabled={saving}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all disabled:opacity-50"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface-hover)' }}
                  >
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: opt.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{opt.label}</p>
                        <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                          próxima em {nextResult.interval_days}d
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{opt.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
