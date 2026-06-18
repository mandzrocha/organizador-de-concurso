'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CalendarPlan, Subject, Topic, ActivityType, ACTIVITY_LABELS, ACTIVITY_ICONS, PlanStatus } from '@/lib/types'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { PageSkeleton } from '@/components/Skeleton'
import { format, addDays, startOfWeek, parseISO, isSameDay, isToday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ChevronLeft, ChevronRight, Sparkles, Plus, Check, X, RotateCcw, CornerDownRight,
  CalendarDays, MapPin, BookOpen as BookOpenIcon, MoreHorizontal,
} from 'lucide-react'
import { ActivityIcon } from '@/lib/activity-icons'

type PlanLoaded = CalendarPlan & {
  topic?: (Topic & { subject?: Subject }) | null
  subject?: Subject | null
}

export default function CalendarPage() {
  const supabase = createClient()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [plans, setPlans] = useState<PlanLoaded[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState<string | null>(null) // date string
  const [showDayDetail, setShowDayDetail] = useState<string | null>(null) // date string
  const [topics, setTopics] = useState<(Topic & { subject: Subject })[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [generating, setGenerating] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [genError, setGenError] = useState('')
  const [exams, setExams] = useState<{ id: string; name: string; is_primary: boolean }[]>([])

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    getUserId(supabase).then(uid => {
      if (!uid) return
      supabase.from('user_exams').select('is_primary, exam:exams(id, name)').eq('user_id', uid)
        .then(({ data }) => setExams(
          (data || []).filter((r: any) => r.exam).map((r: any) => ({ id: r.exam.id, name: r.exam.name, is_primary: r.is_primary }))
        ))
    })
  }, [])

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const loadPlans = useCallback(async () => {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const userId = await getUserId(supabase)
    if (!userId) { setLoading(false); return }
    const from = weekDays[0].toISOString().split('T')[0]
    const to = weekDays[6].toISOString().split('T')[0]
    const { data } = await supabase
      .from('calendar_plans')
      .select('*, topic:topics(*, subject:subjects(*)), subject:subjects(*)')
      .eq('user_id', userId)
      .gte('planned_date', from)
      .lte('planned_date', to)
      .order('order_index')
    setPlans((data || []) as PlanLoaded[])
    setLoading(false)
  }, [weekStart])

  useEffect(() => {
    loadPlans()
    loadTopics()
    loadSubjects()
  }, [loadPlans])

  async function loadTopics() {
    const userId = await getUserId(supabase)
    if (!userId) { setTopics([]); return }
    const { data: enr } = await supabase.from('user_exams').select('exam_id').eq('user_id', userId)
    const examIds = (enr || []).map((e: any) => e.exam_id)
    if (examIds.length === 0) { setTopics([]); return }
    const { data } = await supabase
      .from('topics')
      .select('*, subject:subjects(*)')
      .in('exam_id', examIds)
      .order('name')
    setTopics((data || []) as any)
  }

  async function loadSubjects() {
    const { data } = await supabase.from('subjects').select('*').order('name')
    setSubjects(data || [])
  }

  async function updateStatus(planId: string, status: PlanStatus) {
    const plan = plans.find(p => p.id === planId)
    if (!plan) return

    if (status === 'skipped') {
      // Reschedule to next day
      const currentDate = parseISO(plan.planned_date)
      const nextDate = addDays(currentDate, 1)
      await supabase.from('calendar_plans').update({
        status: 'skipped',
        planned_date: nextDate.toISOString().split('T')[0],
        original_date: plan.planned_date,
      }).eq('id', planId)
    } else {
      await supabase.from('calendar_plans').update({ status }).eq('id', planId)
      if (status === 'done') {
        // Only log if this is a topic-level plan; subject-level plans are aggregate
        // and not individually attached to study_logs (would need to log every topic)
        if (plan.topic_id) {
          const userId = await getUserId(supabase)
          if (userId) {
            await supabase.from('study_logs').insert({
              user_id: userId,
              topic_id: plan.topic_id,
              activity_type: plan.activity_type,
              studied_at: plan.planned_date,
            })
          }
        }
      }
    }
    loadPlans()
  }

  async function deletePlan(planId: string) {
    await supabase.from('calendar_plans').delete().eq('id', planId)
    loadPlans()
  }

  async function generateWithAI(prefs: any) {
    setGenerating(true)
    setGenError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/generate-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(prefs),
      })
      // Resposta pode não ser JSON (ex.: timeout do servidor) — lê com cuidado.
      const raw = await res.text()
      let data: any = {}
      try { data = raw ? JSON.parse(raw) : {} } catch {
        data = { error: 'O servidor demorou para responder. Tente de novo (ou reduza os dias do cronograma).' }
      }
      if (!res.ok) {
        setGenError(data.error || 'Erro ao gerar cronograma')
        setGenerating(false)
        return
      }
      if (data.plans) {
        const userId = await getUserId(supabase)
        const rows = (data.plans as any[]).map(p => ({ ...p, user_id: userId }))
        await supabase.from('calendar_plans').insert(rows)
        loadPlans()
        setShowWizard(false)
      }
    } catch (e: any) {
      setGenError(e.message || 'Erro inesperado')
    }
    setGenerating(false)
  }

  const dayPlans = (date: Date) => plans.filter(p => p.planned_date === date.toISOString().split('T')[0])

  if (loading) return <PageSkeleton variant="default" />

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setWeekStart(d => addDays(d, -7))} className="px-2.5 py-1.5 rounded-lg text-sm border flex items-center" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}><ChevronLeft size={16} /></button>
          <h1 className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {format(weekDays[0], "d MMM", { locale: ptBR })} — {format(weekDays[6], "d MMM yyyy", { locale: ptBR })}
          </h1>
          <button onClick={() => setWeekStart(d => addDays(d, 7))} className="px-2.5 py-1.5 rounded-lg text-sm border flex items-center" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}><ChevronRight size={16} /></button>
          <button onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--primary-strong)' }}>
            Hoje
          </button>
        </div>
        <button
          onClick={() => { setGenError(''); setShowWizard(true) }}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}
        >
          <Sparkles size={14} /> {generating ? 'Gerando...' : 'Gerar cronograma com IA'}
        </button>
      </div>

      {/* Week — horizontal rows per day, compactas */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        {weekDays.map((day, idx) => {
          const dayStr = day.toISOString().split('T')[0]
          const dayPlansArr = dayPlans(day)
          const today = isToday(day)
          const doneCount = dayPlansArr.filter(p => p.status === 'done').length
          const isLast = idx === weekDays.length - 1

          return (
            <div
              key={dayStr}
              className="flex items-stretch transition-colors"
              style={{
                background: today ? 'color-mix(in srgb, var(--primary) 6%, transparent)' : 'transparent',
                borderBottom: isLast ? undefined : '1px solid var(--border)',
                minHeight: 80,
              }}
            >
              {/* Day header (left side) */}
              <button
                onClick={() => setShowDayDetail(dayStr)}
                className="flex flex-col items-center justify-center gap-1 w-28 flex-shrink-0 px-3 py-3 transition-colors hover:bg-[var(--surface-hover)]"
                style={{ borderRight: '1px solid var(--border)' }}
              >
                <p className="text-xs uppercase font-medium tracking-wider" style={{ color: today ? 'var(--primary)' : 'var(--text-muted)' }}>
                  {format(day, 'EEE', { locale: ptBR })}
                </p>
                <p
                  className="text-4xl font-bold leading-none tabular-nums"
                  style={{ color: today ? 'var(--primary)' : 'var(--text)' }}
                >
                  {format(day, 'd')}
                </p>
                <p className="text-xs tabular-nums" style={{ color: doneCount === dayPlansArr.length && dayPlansArr.length > 0 ? 'var(--success)' : 'var(--text-subtle)' }}>
                  {dayPlansArr.length > 0 ? `${doneCount}/${dayPlansArr.length}` : '—'}
                </p>
              </button>

              {/* Plans — wrap multilinha pra caber varios */}
              <div className="flex-1 min-w-0 px-3 py-3 flex items-start gap-2 flex-wrap content-start">
                {dayPlansArr.length === 0 ? (
                  <button
                    onClick={() => setShowAddModal(dayStr)}
                    className="text-xs px-3 py-2 rounded-md transition-colors hover:bg-[var(--surface-hover)] self-center"
                    style={{ color: 'var(--text-subtle)' }}
                  >
                    + adicionar plano
                  </button>
                ) : (
                  <>
                    {dayPlansArr.map(plan => (
                      <PlanChip key={plan.id} plan={plan} onClick={() => setShowDayDetail(dayStr)} />
                    ))}
                    <button
                      onClick={() => setShowAddModal(dayStr)}
                      className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--surface-hover)] border border-dashed"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}
                      title="Adicionar plano"
                    >
                      <Plus size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* AI Wizard */}
      {showWizard && (
        <ScheduleWizard
          exams={exams}
          subjects={[...new Map(topics.filter(t => t.subject).map(t => [t.subject.id, { id: t.subject.id, name: t.subject.name }])).values()]}
          generating={generating}
          error={genError}
          onClose={() => setShowWizard(false)}
          onGenerate={generateWithAI}
        />
      )}

      {/* Day detail modal */}
      {showDayDetail && (
        <DayDetailModal
          date={showDayDetail}
          plans={plans.filter(p => p.planned_date === showDayDetail)}
          onClose={() => setShowDayDetail(null)}
          onDone={(id) => updateStatus(id, 'done')}
          onUndone={(id) => updateStatus(id, 'planned')}
          onSkip={(id) => updateStatus(id, 'skipped')}
          onDelete={(id) => deletePlan(id)}
          onAdd={() => { setShowAddModal(showDayDetail); setShowDayDetail(null) }}
        />
      )}

      {/* Add plan modal */}
      {showAddModal && (
        <AddPlanModal
          date={showAddModal}
          topics={topics}
          subjects={subjects}
          onClose={() => setShowAddModal(null)}
          onSave={async (target, activityTypes, notes) => {
            const existing = plans.filter(p => p.planned_date === showAddModal)
            const userId = await getUserId(supabase)
            if (!userId) return
            // One row per selected activity → each becomes its own task in the day.
            const rows = activityTypes.map((activityType, i) => ({
              user_id: userId,
              planned_date: showAddModal,
              topic_id: target.kind === 'topic' ? target.id : null,
              subject_id: target.kind === 'subject' ? target.id : null,
              activity_type: activityType,
              notes,
              order_index: existing.length + i,
            }))
            await supabase.from('calendar_plans').insert(rows)
            setShowAddModal(null)
            loadPlans()
          }}
        />
      )}
    </div>
  )
}

function DayDetailModal({ date, plans, onClose, onDone, onUndone, onSkip, onDelete, onAdd }: {
  date: string
  plans: PlanLoaded[]
  onClose: () => void
  onDone: (id: string) => void
  onUndone: (id: string) => void
  onSkip: (id: string) => void
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const parsedDate = parseISO(date)
  const todayMatch = isSameDay(parsedDate, new Date())
  const doneCount = plans.filter(p => p.status === 'done').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl rounded-2xl border overflow-hidden flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', maxHeight: '85vh' }}>
        <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--primary)' }}>{format(parsedDate, "EEEE", { locale: ptBR })}{todayMatch ? ' · Hoje' : ''}</p>
              <h2 className="text-lg font-semibold mt-0.5" style={{ color: 'var(--text)' }}>{format(parsedDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}</h2>
              {plans.length > 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {doneCount}/{plans.length} {plans.length === 1 ? 'plano concluído' : 'planos concluídos'}
                </p>
              )}
            </div>
            <button onClick={onClose} style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {plans.length === 0 ? (
            <div className="text-center py-12">
              <CalendarDays size={40} strokeWidth={1.25} className="mx-auto mb-2" style={{ color: 'var(--text-subtle)', opacity: 0.6 }} />
              <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>Nenhum plano para este dia.</p>
            </div>
          ) : (
            plans.map(plan => {
              const subject = plan.topic?.subject || plan.subject
              const isDone = plan.status === 'done'
              const isSkipped = plan.status === 'skipped'
              const isSubjectLevel = !plan.topic_id && plan.subject_id
              return (
                <div
                  key={plan.id}
                  className="rounded-xl border p-3 flex items-center gap-3"
                  style={{
                    background: isDone ? 'var(--success-soft)' : 'var(--surface-hover)',
                    borderColor: isDone ? 'var(--success)' : 'var(--border)',
                    opacity: isSkipped ? 0.6 : 1,
                    borderLeft: subject ? `4px solid ${subject.color}` : undefined,
                  }}
                >
                  <button
                    onClick={() => isDone ? onUndone(plan.id) : onDone(plan.id)}
                    className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 border"
                    style={{
                      background: isDone ? 'var(--success)' : 'transparent',
                      borderColor: isDone ? 'var(--success)' : 'var(--border-strong)',
                    }}
                    title={isDone ? 'Marcar como pendente' : 'Concluir'}
                  >
                    {isDone && <Check size={13} strokeWidth={3} className="text-white" />}
                  </button>

                  <ActivityIcon type={plan.activity_type} size={18} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} />


                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p
                        className="text-sm font-medium"
                        style={{
                          color: isDone ? 'var(--success)' : 'var(--text)',
                          textDecorationLine: isDone ? 'line-through' : 'none',
                        }}
                      >
                        {plan.topic?.name || subject?.name}
                      </p>
                      {isSubjectLevel && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
                          matéria completa
                        </span>
                      )}
                      {plan.original_date && (
                        <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}><CornerDownRight size={11} /> reagendado</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
                      <span>{ACTIVITY_LABELS[plan.activity_type]}</span>
                      {!isSubjectLevel && subject && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: subject.color }} />
                            {subject.name}
                          </span>
                        </>
                      )}
                      {plan.notes && (
                        <>
                          <span>·</span>
                          <span className="italic">{plan.notes}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!isDone && !isSkipped && (
                      <button
                        onClick={() => onSkip(plan.id)}
                        className="px-2 py-1 rounded-md flex items-center"
                        style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
                        title="Pular (reagendar amanhã)"
                      >
                        <CornerDownRight size={12} />
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(plan.id)}
                      className="px-2 py-1 rounded-md flex items-center"
                      style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                      title="Excluir"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="px-5 pb-5 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={onAdd}
            className="w-full py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5"
            style={{ background: 'var(--primary-strong)', color: '#fff' }}
          >
            <Plus size={14} strokeWidth={2.5} /> Adicionar plano para este dia
          </button>
        </div>
      </div>
    </div>
  )
}

function PlanChip({ plan, onClick }: { plan: PlanLoaded; onClick: () => void }) {
  const isDone = plan.status === 'done'
  const isSkipped = plan.status === 'skipped'
  const subject = plan.topic?.subject || plan.subject
  const isSubjectLevel = !plan.topic_id && plan.subject_id
  // Topic plans show the topic as the main label with the subject as a tag on top.
  // Subject-level plans show the subject name with a "matéria completa" hint.
  const mainLabel = plan.topic?.name || subject?.name || '?'

  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 max-w-[220px] rounded-md px-2 py-1.5 flex flex-col items-start gap-1 text-left transition-colors hover:opacity-90"
      style={{
        background: isDone ? 'var(--success-soft)' : 'var(--surface-hover)',
        opacity: isSkipped ? 0.5 : 1,
        borderLeft: subject ? `3px solid ${subject.color}` : undefined,
      }}
    >
      {subject && (
        <span
          className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded leading-none truncate max-w-full"
          style={{ background: `color-mix(in srgb, ${subject.color} 18%, transparent)`, color: subject.color }}
        >
          {isSubjectLevel ? `${subject.name} · completa` : subject.name}
        </span>
      )}
      <span className="flex items-center gap-1.5 max-w-full">
        <ActivityIcon type={plan.activity_type} size={12} className="flex-shrink-0" style={{ color: isDone ? 'var(--success)' : 'var(--text-muted)' }} />
        <span
          className="text-xs font-medium truncate"
          style={{
            color: isDone ? 'var(--success)' : 'var(--text)',
            textDecorationLine: isDone ? 'line-through' : 'none',
          }}
        >
          {mainLabel}
        </span>
        {isDone && <Check size={10} strokeWidth={3} className="flex-shrink-0" style={{ color: 'var(--success)' }} />}
      </span>
    </button>
  )
}

function PlanItem({ plan }: { plan: PlanLoaded }) {
  const isDone = plan.status === 'done'
  const isSkipped = plan.status === 'skipped'
  const isSubjectLevel = !plan.topic_id && plan.subject_id
  const subject = plan.topic?.subject || plan.subject
  const title = plan.topic?.name || subject?.name || '?'

  return (
    <div
      className="rounded-lg px-2 py-1.5 relative"
      style={{
        background: isDone ? 'var(--success-soft)' : isSkipped ? 'var(--surface-hover)' : 'var(--surface-soft)',
        opacity: isSkipped ? 0.5 : 1,
        borderLeft: subject ? `3px solid ${subject.color}` : undefined,
      }}
    >
      {plan.original_date && (
        <div className="text-xs mb-0.5 inline-flex items-center gap-1" style={{ color: 'var(--warning)' }}><CornerDownRight size={10} /> reagendado</div>
      )}
      <div className="flex items-start gap-1.5">
        <ActivityIcon type={plan.activity_type} size={11} className="mt-0.5" style={{ color: 'var(--text-muted)' }} />
        <div className="flex-1 min-w-0">
          <p
            className="text-xs leading-tight truncate font-medium"
            style={{
              color: isDone ? 'var(--success)' : 'var(--text)',
              textDecorationLine: isDone ? 'line-through' : 'none',
            }}
          >
            {title}
          </p>
          {!isSubjectLevel && subject && (
            <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>{subject.name}</p>
          )}
          {isSubjectLevel && (
            <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>matéria completa</p>
          )}
        </div>
      </div>
    </div>
  )
}

type TargetSelection = { kind: 'topic' | 'subject'; id: string }

function AddPlanModal({ date, topics, subjects, onClose, onSave }: {
  date: string
  topics: (Topic & { subject: Subject })[]
  subjects: Subject[]
  onClose: () => void
  onSave: (target: TargetSelection, activityTypes: ActivityType[], notes: string) => Promise<void>
}) {
  const [mode, setMode] = useState<'topic' | 'subject'>('topic')
  const [target, setTarget] = useState<TargetSelection | null>(null)
  const [activities, setActivities] = useState<ActivityType[]>(['video'])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const filteredTopics = topics.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.subject?.name.toLowerCase().includes(search.toLowerCase())
  )
  const filteredSubjects = subjects.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  )

  function toggleActivity(act: ActivityType) {
    setActivities(prev => prev.includes(act) ? prev.filter(a => a !== act) : [...prev, act])
  }

  async function handleSave() {
    if (!target || activities.length === 0) return
    setSaving(true)
    await onSave(target, activities, notes)
    setSaving(false)
  }

  const parsedDate = parseISO(date)

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            Planejar para {format(parsedDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
        </div>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { setMode('topic'); setTarget(null) }}
            className="px-3 py-2.5 rounded-lg border text-sm font-medium transition-all inline-flex items-center justify-center gap-1.5"
            style={{
              background: mode === 'topic' ? 'var(--primary-soft)' : 'var(--surface-hover)',
              borderColor: mode === 'topic' ? 'var(--primary)' : 'var(--border)',
              color: mode === 'topic' ? 'var(--primary-soft-text)' : 'var(--text-muted)',
            }}
          >
            <MapPin size={14} /> Tópico específico
          </button>
          <button
            onClick={() => { setMode('subject'); setTarget(null) }}
            className="px-3 py-2.5 rounded-lg border text-sm font-medium transition-all inline-flex items-center justify-center gap-1.5"
            style={{
              background: mode === 'subject' ? 'var(--primary-soft)' : 'var(--surface-hover)',
              borderColor: mode === 'subject' ? 'var(--primary)' : 'var(--border)',
              color: mode === 'subject' ? 'var(--primary-soft-text)' : 'var(--text-muted)',
            }}
          >
            <BookOpenIcon size={14} /> Matéria inteira
          </button>
        </div>

        <div>
          <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
            {mode === 'topic' ? 'Tópico' : 'Matéria'}
          </label>
          <input
            type="text"
            placeholder={mode === 'topic' ? 'Buscar tópico...' : 'Buscar matéria...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            {mode === 'topic' ? (
              <>
                {filteredTopics.map(topic => (
                  <button
                    key={topic.id}
                    onClick={() => setTarget({ kind: 'topic', id: topic.id })}
                    className="w-full text-left px-3 py-2 text-sm transition-colors"
                    style={{
                      background: target?.kind === 'topic' && target.id === topic.id ? 'var(--primary-soft)' : 'transparent',
                      color: target?.kind === 'topic' && target.id === topic.id ? 'var(--primary-soft-text)' : 'var(--text)',
                    }}
                  >
                    <span>{topic.name}</span>
                    <span className="text-xs ml-2" style={{ color: 'var(--text-subtle)' }}>{topic.subject?.name}</span>
                  </button>
                ))}
                {filteredTopics.length === 0 && (
                  <p className="px-3 py-4 text-xs text-center" style={{ color: 'var(--text-subtle)' }}>Nenhum tópico encontrado</p>
                )}
              </>
            ) : (
              <>
                {filteredSubjects.map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setTarget({ kind: 'subject', id: sub.id })}
                    className="w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2"
                    style={{
                      background: target?.kind === 'subject' && target.id === sub.id ? 'var(--primary-soft)' : 'transparent',
                      color: target?.kind === 'subject' && target.id === sub.id ? 'var(--primary-soft-text)' : 'var(--text)',
                    }}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sub.color }} />
                    <span>{sub.name}</span>
                  </button>
                ))}
                {filteredSubjects.length === 0 && (
                  <p className="px-3 py-4 text-xs text-center" style={{ color: 'var(--text-subtle)' }}>Nenhuma matéria encontrada</p>
                )}
              </>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Atividades <span style={{ color: 'var(--text-subtle)' }}>· escolha uma ou mais (cada uma vira uma tarefa)</span>
          </label>
          <div className="flex gap-2 flex-wrap">
            {(['video', 'exercises', 'reading', 'review'] as ActivityType[]).map(act => {
              const selected = activities.includes(act)
              return (
                <button
                  key={act}
                  onClick={() => toggleActivity(act)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all"
                  style={{
                    background: selected ? 'var(--primary-soft)' : 'transparent',
                    borderColor: selected ? 'var(--primary-strong)' : 'var(--border)',
                    color: selected ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                  }}
                >
                  {selected ? <Check size={12} strokeWidth={3} /> : <ActivityIcon type={act} size={12} />} {ACTIVITY_LABELS[act]}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>Observações (opcional)</label>
          <input type="text" placeholder="Ex: caps. 1-3 do livro X" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!target || activities.length === 0 || saving}
            className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--primary-strong)', color: '#fff' }}
          >
            {saving
              ? 'Salvando...'
              : activities.length > 1
                ? `Adicionar ${activities.length} tarefas`
                : 'Adicionar ao calendário'}
          </button>
        </div>
      </div>
    </div>
  )
}

const WEEK_DAYS = [
  { day: 1, label: 'Seg' },
  { day: 2, label: 'Ter' },
  { day: 3, label: 'Qua' },
  { day: 4, label: 'Qui' },
  { day: 5, label: 'Sex' },
  { day: 6, label: 'Sáb' },
  { day: 0, label: 'Dom' },
]

type ActivityKey = 'video' | 'reading' | 'exercises' | 'review'

function ScheduleWizard({ exams, subjects, generating, error, onClose, onGenerate }: {
  exams: { id: string; name: string; is_primary: boolean }[]
  subjects: { id: string; name: string }[]
  generating: boolean
  error: string
  onClose: () => void
  onGenerate: (prefs: any) => void
}) {
  const [step, setStep] = useState(1)
  const [daysPerWeek, setDaysPerWeek] = useState<number[]>([1, 2, 3, 4, 5])
  const [hoursPerDay, setHoursPerDay] = useState(3)
  const [horizonDays, setHorizonDays] = useState(14)
  const [focus, setFocus] = useState<'primary' | 'all' | 'specific'>('primary')
  const [specificExamIds, setSpecificExamIds] = useState<string[]>([])
  const [completedMode, setCompletedMode] = useState<'skip' | 'review' | 'restudy'>('review')
  const [prioritizeOverdue, setPrioritizeOverdue] = useState(true)
  const [customizeActivities, setCustomizeActivities] = useState(false)
  const [activityDays, setActivityDays] = useState<Record<ActivityKey, number[]>>({
    video:     [1, 2, 3, 4, 5],
    reading:   [1, 2, 3, 4, 5],
    exercises: [1, 2, 3, 4, 5, 6],
    review:    [0, 6],
  })
  const [notes, setNotes] = useState('')
  const [maxSubjectsPerDay, setMaxSubjectsPerDay] = useState(0) // 0 = sem limite
  const [prioritySubjectIds, setPrioritySubjectIds] = useState<string[]>([])

  function togglePriority(id: string) {
    setPrioritySubjectIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleDay(d: number) {
    setDaysPerWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  function toggleActivityDay(act: ActivityKey, d: number) {
    setActivityDays(prev => ({
      ...prev,
      [act]: prev[act].includes(d) ? prev[act].filter(x => x !== d) : [...prev[act], d].sort(),
    }))
  }

  function toggleExam(id: string) {
    setSpecificExamIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function submit() {
    onGenerate({
      daysPerWeek, hoursPerDay, horizonDays, focus,
      specificExamIds: focus === 'specific' ? specificExamIds : undefined,
      completedSubjectsMode: completedMode,
      prioritizeOverdueReviews: prioritizeOverdue,
      activityDays: customizeActivities ? activityDays : undefined,
      maxSubjectsPerDay: maxSubjectsPerDay > 0 ? maxSubjectsPerDay : undefined,
      prioritySubjectIds: prioritySubjectIds.length ? prioritySubjectIds : undefined,
      notes: notes.trim() || undefined,
    })
  }

  const TOTAL_STEPS = 5
  const canAdvance = step === 1 ? daysPerWeek.length > 0
    : step === 2 ? true
    : step === 3 ? (focus !== 'specific' || specificExamIds.length > 0)
    : step === 4 ? true
    : true

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium inline-flex items-center gap-1.5" style={{ color: 'var(--primary)' }}><Sparkles size={12} /> Gerar cronograma com IA</p>
              <h2 className="text-base font-semibold mt-0.5" style={{ color: 'var(--text)' }}>Como você quer estudar?</h2>
            </div>
            <button onClick={onClose} style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
          </div>
          {/* Step indicator */}
          <div className="flex gap-2 mt-4">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(s => (
              <div key={s} className="flex-1 h-1 rounded-full" style={{ background: s <= step ? 'var(--primary)' : 'var(--border)' }} />
            ))}
          </div>
        </div>

        <div className="p-5 space-y-4 min-h-[280px]">
          {step === 1 && (
            <>
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>Quais dias da semana você estuda?</p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Selecione um ou mais dias</p>
                <div className="grid grid-cols-7 gap-2">
                  {WEEK_DAYS.map(d => (
                    <button
                      key={d.day}
                      onClick={() => toggleDay(d.day)}
                      className="py-2 rounded-lg text-xs font-medium transition-all border"
                      style={{
                        background: daysPerWeek.includes(d.day) ? 'var(--primary-soft)' : 'var(--surface-hover)',
                        borderColor: daysPerWeek.includes(d.day) ? 'var(--primary)' : 'var(--border)',
                        color: daysPerWeek.includes(d.day) ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>Quantas horas por dia em média?</p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{hoursPerDay}h por dia · ~{Math.max(2, Math.round(hoursPerDay * 2))} atividades</p>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={hoursPerDay}
                  onChange={e => setHoursPerDay(parseInt(e.target.value))}
                  className="w-full"
                  style={{ accentColor: 'var(--primary)' }}
                />
                <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>
                  <span>1h</span><span>5h</span><span>10h</span>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>Período do cronograma</p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Por quantos dias gerar?</p>
                <div className="grid grid-cols-4 gap-2">
                  {[7, 14, 30, 60].map(n => (
                    <button
                      key={n}
                      onClick={() => setHorizonDays(n)}
                      className="py-3 rounded-lg text-sm font-medium transition-all border"
                      style={{
                        background: horizonDays === n ? 'var(--primary-soft)' : 'var(--surface-hover)',
                        borderColor: horizonDays === n ? 'var(--primary)' : 'var(--border)',
                        color: horizonDays === n ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                      }}
                    >
                      {n} dias
                    </button>
                  ))}
                </div>
                <div className="mt-3">
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={horizonDays}
                    onChange={e => setHorizonDays(Math.min(365, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-full"
                    placeholder="Ou digite o número de dias"
                  />
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>Foco do cronograma</p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Quais concursos incluir?</p>
                <div className="space-y-2">
                  {[
                    { value: 'primary' as const, label: 'Apenas concurso foco principal', desc: 'Recomendado se você tem prioridade clara' },
                    { value: 'all' as const, label: 'Todos os concursos cadastrados', desc: 'Distribui entre todos' },
                    { value: 'specific' as const, label: 'Concursos específicos', desc: 'Você escolhe quais' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFocus(opt.value)}
                      className="w-full text-left px-4 py-3 rounded-lg border transition-all"
                      style={{
                        background: focus === opt.value ? 'var(--primary-soft)' : 'var(--surface-hover)',
                        borderColor: focus === opt.value ? 'var(--primary)' : 'var(--border)',
                      }}
                    >
                      <p className="text-sm font-medium" style={{ color: focus === opt.value ? 'var(--primary-soft-text)' : 'var(--text)' }}>{opt.label}</p>
                      <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>{opt.desc}</p>
                    </button>
                  ))}
                </div>

                {focus === 'specific' && (
                  <div className="mt-3 space-y-1">
                    {exams.map(ex => (
                      <label key={ex.id} className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer" style={{ background: 'var(--surface-hover)' }}>
                        <input
                          type="checkbox"
                          checked={specificExamIds.includes(ex.id)}
                          onChange={() => toggleExam(ex.id)}
                          className="w-4 h-4"
                          style={{ accentColor: 'var(--primary)' }}
                        />
                        <span className="text-sm flex-1" style={{ color: 'var(--text)' }}>{ex.name}</span>
                        {ex.is_primary && <span className="text-xs" style={{ color: 'var(--primary)' }}>★</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>Padrão por tipo de atividade</p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  Ex: revisão só no domingo, exercícios no fim de semana
                </p>

                <label className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg cursor-pointer" style={{ background: 'var(--surface-hover)' }}>
                  <input
                    type="checkbox"
                    checked={customizeActivities}
                    onChange={e => setCustomizeActivities(e.target.checked)}
                    className="w-4 h-4"
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <span className="text-sm" style={{ color: 'var(--text)' }}>Definir dias específicos por atividade</span>
                </label>

                {customizeActivities && (
                  <div className="space-y-3">
                    {([
                      { key: 'video' as ActivityKey,     icon: '🎬', label: 'Videoaula' },
                      { key: 'reading' as ActivityKey,   icon: '📖', label: 'Leitura' },
                      { key: 'exercises' as ActivityKey, icon: '✏️', label: 'Exercícios' },
                      { key: 'review' as ActivityKey,    icon: '🔁', label: 'Revisão' },
                    ]).map(a => (
                      <div key={a.key}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span>{a.icon}</span>
                          <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>{a.label}</span>
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {WEEK_DAYS.map(d => (
                            <button
                              key={d.day}
                              onClick={() => toggleActivityDay(a.key, d.day)}
                              className="py-1.5 rounded-md text-[10px] font-medium border transition-all"
                              style={{
                                background: activityDays[a.key].includes(d.day) ? 'var(--primary-soft)' : 'var(--surface-hover)',
                                borderColor: activityDays[a.key].includes(d.day) ? 'var(--primary)' : 'var(--border)',
                                color: activityDays[a.key].includes(d.day) ? 'var(--primary-soft-text)' : 'var(--text-subtle)',
                              }}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium mb-1 mt-4" style={{ color: 'var(--text)' }}>Observações (opcional)</p>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Conte para a IA qualquer preferência específica</p>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Ex: não estudar matemática antes de dormir, focar em direito constitucional na segunda quinzena, simulado no último domingo..."
                  style={{ resize: 'none' }}
                />
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--text)' }}>Ajustes finais</p>
              <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer" style={{ background: 'var(--surface-hover)' }}>
                <input
                  type="checkbox"
                  checked={prioritizeOverdue}
                  onChange={e => setPrioritizeOverdue(e.target.checked)}
                  className="w-4 h-4 mt-0.5"
                  style={{ accentColor: 'var(--primary)' }}
                />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Priorizar revisões em atraso</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Coloca os tópicos atrasados nos primeiros dias do cronograma</p>
                </div>
              </label>

              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>Matérias que você já concluiu</p>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>O que fazer com tópicos/matérias marcados como concluídos?</p>
                <div className="space-y-2">
                  {[
                    { value: 'review' as const, label: 'Apenas revisar', desc: 'Revisões espaçadas para manter o conteúdo fresco (recomendado)' },
                    { value: 'restudy' as const, label: 'Estudar de novo do zero', desc: 'Reinclui todas as atividades — útil quando o edital reabriu ou você quer reforçar' },
                    { value: 'skip' as const, label: 'Não incluir', desc: 'Ignora matérias concluídas neste cronograma' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setCompletedMode(opt.value)}
                      className="w-full text-left px-4 py-2.5 rounded-lg border transition-all"
                      style={{
                        background: completedMode === opt.value ? 'var(--primary-soft)' : 'var(--surface-hover)',
                        borderColor: completedMode === opt.value ? 'var(--primary)' : 'var(--border)',
                      }}
                    >
                      <p className="text-sm font-medium" style={{ color: completedMode === opt.value ? 'var(--primary-soft-text)' : 'var(--text)' }}>{opt.label}</p>
                      <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Máximo de matérias por dia */}
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>Máximo de matérias por dia</p>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Prefere focar em poucas matérias por dia? Limite a variedade.</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {[{ v: 1, l: '1 matéria' }, { v: 2, l: '2 matérias' }, { v: 3, l: '3 matérias' }, { v: 0, l: 'Sem limite' }].map(o => (
                    <button
                      key={o.v}
                      onClick={() => setMaxSubjectsPerDay(o.v)}
                      className="text-xs px-3 py-2 rounded-lg border transition-colors"
                      style={{
                        background: maxSubjectsPerDay === o.v ? 'var(--primary-soft)' : 'var(--surface-hover)',
                        borderColor: maxSubjectsPerDay === o.v ? 'var(--primary)' : 'var(--border)',
                        color: maxSubjectsPerDay === o.v ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                      }}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Matérias prioritárias */}
              {subjects.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
                    Matérias prioritárias <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>· opcional</span>
                  </p>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>A IA agenda as marcadas primeiro e com mais frequência.</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {subjects.map(s => {
                      const on = prioritySubjectIds.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          onClick={() => togglePriority(s.id)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                          style={{
                            background: on ? 'var(--primary-soft)' : 'transparent',
                            borderColor: on ? 'var(--primary)' : 'var(--border)',
                            color: on ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                          }}
                        >
                          {on ? '★ ' : ''}{s.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="mt-4 p-3 rounded-lg text-xs" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
                <p className="font-medium mb-1">Resumo</p>
                <p>· {daysPerWeek.length} dias/semana, {hoursPerDay}h por dia</p>
                <p>· Cronograma de {horizonDays} dias</p>
                <p>· Foco: {focus === 'primary' ? 'concurso principal' : focus === 'all' ? 'todos os concursos' : `${specificExamIds.length} concurso(s) selecionado(s)`}</p>
                <p>· Concluídas: {completedMode === 'review' ? 'apenas revisar' : completedMode === 'restudy' ? 'estudar de novo' : 'não incluir'}</p>
                {maxSubjectsPerDay > 0 && <p>· Até {maxSubjectsPerDay} matéria(s) por dia</p>}
                {prioritySubjectIds.length > 0 && <p>· {prioritySubjectIds.length} matéria(s) prioritária(s)</p>}
                {customizeActivities && <p>· Padrões por atividade definidos</p>}
                {notes.trim() && <p>· Observações enviadas para a IA</p>}
              </div>

              {error && (
                <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{error}</div>
              )}
            </>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-3">
          {step > 1 ? (
            <button onClick={() => setStep(step - 1)} className="px-4 py-2.5 rounded-xl text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              Voltar
            </button>
          ) : (
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              Cancelar
            </button>
          )}
          {step < TOTAL_STEPS ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canAdvance}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--primary-strong)', color: '#fff' }}
            >
              Próximo
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={generating}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
              style={{ background: 'var(--primary-strong)', color: '#fff' }}
            >
              {generating ? 'Gerando...' : <><Sparkles size={14} /> Gerar cronograma</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
