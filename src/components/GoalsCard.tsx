'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { useToast } from './Toast'
import { useDataChanged, emitDataChanged } from '@/lib/events'
import { UserGoals } from '@/lib/types'
import { startOfWeek, endOfWeek, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Target, X, Clock, PenLine, CheckCircle2, Flame, Pencil } from 'lucide-react'

interface Progress { minutes: number; questions: number; topics: number; days: number }

const GOAL_DEFS = [
  { key: 'weekly_minutes' as const,   icon: Clock,       label: 'Tempo de estudo',     unit: 'min', fmt: (v: number) => fmtMin(v) },
  { key: 'weekly_questions' as const, icon: PenLine,     label: 'Questões resolvidas', unit: 'questões', fmt: (v: number) => String(v) },
  { key: 'weekly_topics' as const,    icon: CheckCircle2, label: 'Tópicos concluídos', unit: 'tópicos', fmt: (v: number) => String(v) },
  { key: 'weekly_days' as const,      icon: Flame,       label: 'Dias estudando',      unit: 'dias', fmt: (v: number) => String(v) },
]

function fmtMin(min: number) {
  const h = Math.floor(min / 60), m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${m}`
}

export function GoalsCard() {
  const supabase = createClient()
  const [goals, setGoals] = useState<UserGoals | null>(null)
  const [progress, setProgress] = useState<Progress>({ minutes: 0, questions: 0, topics: 0, days: 0 })
  const [available, setAvailable] = useState(true) // false se a tabela ainda não existe
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  useEffect(() => { load() }, [])
  useDataChanged(() => { load() })

  async function load() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const userId = await getUserId(supabase)
    if (!userId) { setLoading(false); return }

    const monday = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sunday = endOfWeek(new Date(), { weekStartsOn: 1 })
    const from = monday.toISOString().split('T')[0]
    const to = sunday.toISOString().split('T')[0]

    const goalsRes = await supabase.from('user_goals').select('*').eq('user_id', userId).maybeSingle()
    if (goalsRes.error) {
      // Tabela provavelmente ainda não foi criada no Supabase
      setAvailable(false); setLoading(false); return
    }
    setGoals(goalsRes.data as UserGoals | null)

    const [logsRes, topicsRes] = await Promise.all([
      supabase.from('study_logs').select('studied_at, duration_minutes, total_questions').eq('user_id', userId).gte('studied_at', from).lte('studied_at', to),
      supabase.from('user_topic_progress').select('completed_at').eq('user_id', userId).not('completed_at', 'is', null).gte('completed_at', from).lte('completed_at', to + 'T23:59:59'),
    ])
    const logs = logsRes.data || []
    const minutes = logs.reduce((s: number, l: any) => s + (l.duration_minutes || 0), 0)
    const questions = logs.reduce((s: number, l: any) => s + (l.total_questions || 0), 0)
    const days = new Set(logs.map((l: any) => l.studied_at)).size
    const topics = (topicsRes.data || []).length
    setProgress({ minutes, questions, topics, days })
    setLoading(false)
  }

  const activeGoals = useMemo(
    () => GOAL_DEFS.filter(d => goals && goals[d.key] != null && (goals[d.key] as number) > 0),
    [goals],
  )

  if (loading || !available) return null

  const weekLabel = `${format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'd MMM', { locale: ptBR })} – ${format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'd MMM', { locale: ptBR })}`

  return (
    <div className="ef-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target size={16} style={{ color: 'var(--primary)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Metas da semana</h3>
          <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>· {weekLabel}</span>
        </div>
        <button onClick={() => setEditing(true)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors hover:bg-[var(--surface-hover)]" style={{ color: 'var(--primary-strong)' }}>
          <Pencil size={11} /> {activeGoals.length > 0 ? 'Editar' : 'Definir metas'}
        </button>
      </div>

      {activeGoals.length === 0 ? (
        <p className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>
          Defina metas semanais (tempo, questões, tópicos ou dias) para acompanhar seu ritmo de estudo.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          {activeGoals.map(d => {
            const target = goals![d.key] as number
            const current = progress[d.key === 'weekly_minutes' ? 'minutes' : d.key === 'weekly_questions' ? 'questions' : d.key === 'weekly_topics' ? 'topics' : 'days']
            const pct = Math.min(100, Math.round((current / target) * 100))
            const done = current >= target
            const Icon = d.icon
            const color = done ? 'var(--success)' : 'var(--primary)'
            return (
              <div key={d.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Icon size={13} style={{ color }} /> {d.label}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: done ? 'var(--success)' : 'var(--text)' }}>
                    <strong>{d.fmt(current)}</strong> / {d.fmt(target)}
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
                  <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: done ? 'var(--success)' : 'linear-gradient(90deg, var(--primary-strong), var(--primary))' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && <GoalsModal goals={goals} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); emitDataChanged(); load() }} />}
    </div>
  )
}

function GoalsModal({ goals, onClose, onSaved }: { goals: UserGoals | null; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient()
  const toast = useToast()
  const [vals, setVals] = useState<Record<string, string>>({
    weekly_minutes: goals?.weekly_minutes != null ? String(goals.weekly_minutes) : '',
    weekly_questions: goals?.weekly_questions != null ? String(goals.weekly_questions) : '',
    weekly_topics: goals?.weekly_topics != null ? String(goals.weekly_topics) : '',
    weekly_days: goals?.weekly_days != null ? String(goals.weekly_days) : '',
  })
  const [saving, setSaving] = useState(false)

  // presets úteis para tempo (em minutos)
  const set = (k: string, v: string) => setVals(p => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true)
    try {
      const userId = await getUserId(supabase)
      if (!userId) { toast.error('Sua sessão expirou. Faça login novamente.'); setSaving(false); return }
      const num = (s: string) => { const n = parseInt(s); return Number.isFinite(n) && n > 0 ? n : null }
      const payload = {
        user_id: userId,
        weekly_minutes: num(vals.weekly_minutes),
        weekly_questions: num(vals.weekly_questions),
        weekly_topics: num(vals.weekly_topics),
        weekly_days: vals.weekly_days ? Math.min(7, parseInt(vals.weekly_days) || 0) || null : null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('user_goals').upsert(payload, { onConflict: 'user_id' })
      if (error) throw error
      toast.success('Metas atualizadas!')
      onSaved()
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message || 'tente novamente'))
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { key: 'weekly_minutes', label: 'Tempo de estudo (min/semana)', icon: Clock, placeholder: '600', hint: '600 min = 10h' },
    { key: 'weekly_questions', label: 'Questões por semana', icon: PenLine, placeholder: '300' },
    { key: 'weekly_topics', label: 'Tópicos concluídos por semana', icon: CheckCircle2, placeholder: '5' },
    { key: 'weekly_days', label: 'Dias estudando por semana (0-7)', icon: Flame, placeholder: '5' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Metas semanais</h2>
          <button onClick={onClose} style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Deixe em branco a meta que não quiser acompanhar.</p>
          {fields.map(f => {
            const Icon = f.icon
            return (
              <div key={f.key}>
                <label className="text-xs block mb-1.5 inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <Icon size={13} style={{ color: 'var(--primary)' }} /> {f.label}
                </label>
                <input
                  type="number" min="0" placeholder={f.placeholder}
                  value={vals[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                />
                {f.hint && <p className="text-[11px] mt-1" style={{ color: 'var(--text-subtle)' }}>{f.hint}</p>}
              </div>
            )
          })}
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Cancelar</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
            {saving ? 'Salvando...' : 'Salvar metas'}
          </button>
        </div>
      </div>
    </div>
  )
}
