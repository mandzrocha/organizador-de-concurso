'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CalendarPlan, Subject, Topic, ActivityType, ACTIVITY_LABELS, ACTIVITY_ICONS, PlanStatus } from '@/lib/types'
import { isSupabaseConfigured } from '@/lib/config'
import { format, addDays, startOfWeek, parseISO, isSameDay, isToday } from 'date-fns'
import { ptBR } from 'date-fns/locale'

type PlanWithTopic = CalendarPlan & { topic: Topic & { subject: Subject } }

export default function CalendarPage() {
  const supabase = createClient()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [plans, setPlans] = useState<PlanWithTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState<string | null>(null) // date string
  const [topics, setTopics] = useState<(Topic & { subject: Subject })[]>([])
  const [generating, setGenerating] = useState(false)

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const loadPlans = useCallback(async () => {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const from = weekDays[0].toISOString().split('T')[0]
    const to = weekDays[6].toISOString().split('T')[0]
    const { data } = await supabase
      .from('calendar_plans')
      .select('*, topic:topics(*, subject:subjects(*))')
      .gte('planned_date', from)
      .lte('planned_date', to)
      .order('order_index')
    setPlans((data || []) as PlanWithTopic[])
    setLoading(false)
  }, [weekStart])

  useEffect(() => {
    loadPlans()
    loadTopics()
  }, [loadPlans])

  async function loadTopics() {
    const { data } = await supabase
      .from('topics')
      .select('*, subject:subjects(*)')
      .order('name')
    setTopics((data || []) as any)
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
        await supabase.from('study_logs').insert({
          topic_id: plan.topic_id,
          activity_type: plan.activity_type,
          studied_at: plan.planned_date,
        })
      }
    }
    loadPlans()
  }

  async function deletePlan(planId: string) {
    await supabase.from('calendar_plans').delete().eq('id', planId)
    loadPlans()
  }

  async function generateWithAI() {
    setGenerating(true)
    try {
      const res = await fetch('/api/generate-schedule', { method: 'POST' })
      const data = await res.json()
      if (data.plans) {
        await supabase.from('calendar_plans').insert(data.plans)
        loadPlans()
      }
    } catch (e) {
      console.error(e)
    }
    setGenerating(false)
  }

  const dayPlans = (date: Date) => plans.filter(p => p.planned_date === date.toISOString().split('T')[0])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setWeekStart(d => addDays(d, -7))} className="px-3 py-1.5 rounded-lg text-sm border" style={{ borderColor: '#2a2a38', color: '#8888a0' }}>←</button>
          <h1 className="text-sm font-medium" style={{ color: '#e8e8f0' }}>
            {format(weekDays[0], "d MMM", { locale: ptBR })} — {format(weekDays[6], "d MMM yyyy", { locale: ptBR })}
          </h1>
          <button onClick={() => setWeekStart(d => addDays(d, 7))} className="px-3 py-1.5 rounded-lg text-sm border" style={{ borderColor: '#2a2a38', color: '#8888a0' }}>→</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs px-2 py-1 rounded" style={{ color: '#6366f1' }}>
            Hoje
          </button>
        </div>
        <button
          onClick={generateWithAI}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#1e1e30', color: '#818cf8' }}
        >
          {generating ? '⏳ Gerando...' : '✨ Gerar cronograma com IA'}
        </button>
      </div>

      {/* Week grid */}
      <div className="grid grid-cols-7 gap-3">
        {weekDays.map(day => {
          const dayStr = day.toISOString().split('T')[0]
          const dayPlansArr = dayPlans(day)
          const today = isToday(day)

          return (
            <div key={dayStr} className="min-h-48 rounded-xl border flex flex-col" style={{ background: '#17171f', borderColor: today ? '#6366f1' : '#2a2a38' }}>
              {/* Day header */}
              <div className="px-3 py-2 border-b" style={{ borderColor: '#2a2a38' }}>
                <p className="text-xs" style={{ color: '#8888a0' }}>
                  {format(day, 'EEE', { locale: ptBR })}
                </p>
                <p
                  className="text-lg font-semibold leading-none mt-0.5"
                  style={{ color: today ? '#818cf8' : '#e8e8f0' }}
                >
                  {format(day, 'd')}
                </p>
              </div>

              {/* Plans */}
              <div className="flex-1 p-2 space-y-1.5 overflow-y-auto">
                {dayPlansArr.map(plan => (
                  <PlanItem
                    key={plan.id}
                    plan={plan}
                    onDone={() => updateStatus(plan.id, 'done')}
                    onSkip={() => updateStatus(plan.id, 'skipped')}
                    onDelete={() => deletePlan(plan.id)}
                  />
                ))}
              </div>

              {/* Add button */}
              <button
                onClick={() => setShowAddModal(dayStr)}
                className="m-2 mt-0 py-1 rounded-lg text-xs border border-dashed transition-colors hover:border-indigo-500"
                style={{ borderColor: '#2a2a38', color: '#555568' }}
              >
                + planejar
              </button>
            </div>
          )
        })}
      </div>

      {/* Add plan modal */}
      {showAddModal && (
        <AddPlanModal
          date={showAddModal}
          topics={topics}
          onClose={() => setShowAddModal(null)}
          onSave={async (topicId, activityType, notes) => {
            const existing = plans.filter(p => p.planned_date === showAddModal)
            await supabase.from('calendar_plans').insert({
              planned_date: showAddModal,
              topic_id: topicId,
              activity_type: activityType,
              notes,
              order_index: existing.length,
            })
            setShowAddModal(null)
            loadPlans()
          }}
        />
      )}
    </div>
  )
}

function PlanItem({ plan, onDone, onSkip, onDelete }: {
  plan: PlanWithTopic
  onDone: () => void
  onSkip: () => void
  onDelete: () => void
}) {
  const [showActions, setShowActions] = useState(false)
  const isDone = plan.status === 'done'
  const isSkipped = plan.status === 'skipped'

  return (
    <div
      className="rounded-lg px-2 py-1.5 relative group cursor-pointer"
      style={{
        background: isDone ? '#1a2a1a' : isSkipped ? '#1e1e1e' : '#1e1e2a',
        opacity: isSkipped ? 0.5 : 1,
      }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {plan.original_date && (
        <div className="text-xs mb-0.5" style={{ color: '#f97316' }}>↩ reagendado</div>
      )}
      <div className="flex items-start gap-1">
        <span className="text-xs mt-0.5">{ACTIVITY_ICONS[plan.activity_type]}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs leading-tight truncate" style={{ color: isDone ? '#4ade80' : '#c8c8e0', textDecoration: isDone ? 'line-through' : 'none' }}>
            {plan.topic?.name}
          </p>
          <p className="text-xs" style={{ color: '#555568' }}>{plan.topic?.subject?.name}</p>
        </div>
      </div>
      {showActions && !isDone && (
        <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-lg" style={{ background: 'rgba(15,15,19,0.9)' }}>
          <button onClick={onDone} className="text-xs px-2 py-1 rounded font-medium" style={{ background: '#1a2a1a', color: '#4ade80' }}>✓</button>
          <button onClick={onSkip} className="text-xs px-2 py-1 rounded" style={{ background: '#2a2010', color: '#f97316' }}>↩</button>
          <button onClick={onDelete} className="text-xs px-2 py-1 rounded" style={{ background: '#2a1010', color: '#f87171' }}>✕</button>
        </div>
      )}
    </div>
  )
}

function AddPlanModal({ date, topics, onClose, onSave }: {
  date: string
  topics: (Topic & { subject: Subject })[]
  onClose: () => void
  onSave: (topicId: string, activityType: ActivityType, notes: string) => Promise<void>
}) {
  const [topicId, setTopicId] = useState('')
  const [activity, setActivity] = useState<ActivityType>('video')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = topics.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.subject?.name.toLowerCase().includes(search.toLowerCase())
  )

  async function handleSave() {
    if (!topicId) return
    setSaving(true)
    await onSave(topicId, activity, notes)
    setSaving(false)
  }

  const parsedDate = parseISO(date)

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium" style={{ color: '#e8e8f0' }}>
            Planejar para {format(parsedDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </h2>
          <button onClick={onClose} style={{ color: '#555568' }}>✕</button>
        </div>

        <div>
          <label className="block text-xs mb-1.5" style={{ color: '#8888a0' }}>Tópico</label>
          <input type="text" placeholder="Buscar tópico..." value={search} onChange={e => setSearch(e.target.value)} className="mb-2" />
          <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border" style={{ borderColor: '#2a2a38' }}>
            {filtered.map(topic => (
              <button
                key={topic.id}
                onClick={() => setTopicId(topic.id)}
                className="w-full text-left px-3 py-2 text-sm transition-colors"
                style={{
                  background: topicId === topic.id ? '#1e1e30' : 'transparent',
                  color: topicId === topic.id ? '#818cf8' : '#c8c8e0',
                }}
              >
                <span>{topic.name}</span>
                <span className="text-xs ml-2" style={{ color: '#555568' }}>{topic.subject?.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-xs text-center" style={{ color: '#555568' }}>Nenhum tópico encontrado</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs mb-1.5" style={{ color: '#8888a0' }}>Atividade</label>
          <div className="flex gap-2 flex-wrap">
            {(['video', 'exercises', 'reading', 'review'] as ActivityType[]).map(act => (
              <button
                key={act}
                onClick={() => setActivity(act)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all"
                style={{
                  background: activity === act ? '#1e1e30' : 'transparent',
                  borderColor: activity === act ? '#6366f1' : '#2a2a38',
                  color: activity === act ? '#818cf8' : '#8888a0',
                }}
              >
                {ACTIVITY_ICONS[act]} {ACTIVITY_LABELS[act]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs mb-1.5" style={{ color: '#8888a0' }}>Observações (opcional)</label>
          <input type="text" placeholder="Ex: caps. 1-3 do livro X" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#2a2a38', color: '#8888a0' }}>Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!topicId || saving}
            className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ background: '#6366f1', color: '#fff' }}
          >
            {saving ? 'Salvando...' : 'Adicionar ao calendário'}
          </button>
        </div>
      </div>
    </div>
  )
}
