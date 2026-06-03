'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { Subject, Topic, ActivityType } from '@/lib/types'
import { sm2 } from '@/lib/sm2'
import { useToast } from './Toast'
import { emitDataChanged, useDataChanged } from '@/lib/events'
import { ACTIVITY_ICON_MAP } from '@/lib/activity-icons'
import {
  Plus, X, Timer, Play, Pause, RotateCcw, Minimize2, Maximize2, Check,
} from 'lucide-react'

interface StudyToolsApi {
  pomodoroOpen: boolean
  openPomodoro: () => void
  closePomodoro: () => void
  openQuickLog: () => void
  hasTopics: boolean
}

const StudyToolsContext = createContext<StudyToolsApi>({
  pomodoroOpen: false, openPomodoro: () => {}, closePomodoro: () => {}, openQuickLog: () => {}, hasTopics: false,
})

export function useStudyTools() {
  return useContext(StudyToolsContext)
}

export function StudyToolsProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const [pomodoroOpen, setPomodoroOpen] = useState(false)
  const [pomodoroMinimized, setPomodoroMinimized] = useState(false)
  const [quickLogOpen, setQuickLogOpen] = useState(false)
  const [topics, setTopics] = useState<(Topic & { subject: Subject })[]>([])
  const pomo = usePomodoro()

  const loadTopics = useMemo(() => async () => {
    if (!isSupabaseConfigured()) return
    try {
      const { data } = await supabase.from('topics').select('*, subject:subjects(*)')
      setTopics((data || []) as any)
    } catch { /* sem config — ignora */ }
  }, [supabase])

  useEffect(() => { loadTopics() }, [loadTopics])
  useDataChanged(loadTopics)

  const api: StudyToolsApi = {
    pomodoroOpen,
    openPomodoro: () => { setPomodoroOpen(true); setPomodoroMinimized(false) },
    closePomodoro: () => { setPomodoroOpen(false); pomo.setRunning(false) },
    openQuickLog: () => setQuickLogOpen(true),
    hasTopics: topics.length > 0,
  }

  return (
    <StudyToolsContext.Provider value={api}>
      {children}

      {/* Pomodoro */}
      {pomodoroOpen && !pomodoroMinimized && (
        <PomodoroFullscreen
          pomo={pomo}
          onMinimize={() => setPomodoroMinimized(true)}
          onClose={() => { setPomodoroOpen(false); pomo.setRunning(false) }}
        />
      )}
      {pomodoroOpen && pomodoroMinimized && (
        <PomodoroMinimized
          pomo={pomo}
          onExpand={() => setPomodoroMinimized(false)}
          onClose={() => { setPomodoroOpen(false); pomo.setRunning(false) }}
        />
      )}

      {/* FAB global de registro rápido */}
      {topics.length > 0 && (
        <button
          onClick={() => setQuickLogOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center transition-transform hover:scale-110"
          style={{
            background: 'linear-gradient(135deg, var(--primary-strong), var(--primary))',
            color: '#fff',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 40,
          }}
          title="Registrar estudo agora"
          aria-label="Registrar estudo agora"
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
      )}

      {quickLogOpen && (
        <QuickLogModal
          topics={topics}
          onClose={() => setQuickLogOpen(false)}
          onSaved={() => { setQuickLogOpen(false); emitDataChanged() }}
        />
      )}
    </StudyToolsContext.Provider>
  )
}

// ============== Pomodoro ==============
type PomodoroMode = 'focus' | 'break'
const FOCUS_MIN = 25
const BREAK_MIN = 5

function usePomodoro() {
  const [mode, setMode] = useState<PomodoroMode>('focus')
  const [remaining, setRemaining] = useState(FOCUS_MIN * 60)
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(0)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          if (mode === 'focus') {
            setCompleted(c => c + 1)
            setMode('break')
            try {
              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                new Notification('Pomodoro: hora da pausa!', { body: '5 minutos de descanso.' })
              }
            } catch {}
            return BREAK_MIN * 60
          } else {
            setMode('focus')
            try {
              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                new Notification('Pomodoro: hora de focar!', { body: '25 minutos de estudo.' })
              }
            } catch {}
            return FOCUS_MIN * 60
          }
        }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [running, mode])

  // Pede permissão de notificação SÓ quando o usuário inicia o timer (gesto do
  // usuário), não no carregamento do app — evita prompt intrusivo logo de cara.
  useEffect(() => {
    if (running && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [running])

  function reset() {
    setRunning(false)
    setRemaining(mode === 'focus' ? FOCUS_MIN * 60 : BREAK_MIN * 60)
  }
  function switchMode(m: PomodoroMode) {
    setMode(m)
    setRunning(false)
    setRemaining(m === 'focus' ? FOCUS_MIN * 60 : BREAK_MIN * 60)
  }
  return { mode, remaining, running, completed, setRunning, reset, switchMode }
}

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60), s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function PomodoroFullscreen({
  pomo, onMinimize, onClose,
}: {
  pomo: ReturnType<typeof usePomodoro>
  onMinimize: () => void
  onClose: () => void
}) {
  const { mode, remaining, running, completed, setRunning, reset, switchMode } = pomo
  const isfocus = mode === 'focus'
  const total = (isfocus ? FOCUS_MIN : BREAK_MIN) * 60
  const progress = ((total - remaining) / total) * 100
  const accent = isfocus ? 'var(--primary)' : 'var(--success)'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: isfocus
          ? 'radial-gradient(circle at center, color-mix(in srgb, var(--primary) 12%, var(--bg)) 0%, var(--bg) 70%)'
          : 'radial-gradient(circle at center, color-mix(in srgb, var(--success) 12%, var(--bg)) 0%, var(--bg) 70%)',
      }}
    >
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-5">
        <div className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
          {completed > 0 && (
            <span>{completed} {completed === 1 ? 'ciclo concluído' : 'ciclos concluídos'} hoje</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onMinimize}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            title="Minimizar (timer continua)"
          >
            <Minimize2 size={16} />
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            title="Fechar"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-8">
        <div className="flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' }}>
          <Timer size={16} style={{ color: accent }} />
          <span className="text-sm font-semibold" style={{ color: accent }}>
            {isfocus ? 'Hora de focar' : 'Hora da pausa'}
          </span>
        </div>

        <div className="relative" style={{ width: 380, height: 380, maxWidth: '70vmin', maxHeight: '70vmin' }}>
          <svg viewBox="0 0 200 200" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="100" cy="100" r="92" fill="none" stroke="var(--border)" strokeWidth="6" />
            <circle
              cx="100" cy="100" r="92" fill="none"
              stroke={accent}
              strokeWidth="6"
              strokeDasharray={`${(progress / 100) * 578} 578`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-7xl font-bold tabular-nums leading-none" style={{ color: 'var(--text)', letterSpacing: '-0.02em' }}>
              {fmtTime(remaining)}
            </p>
            <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>
              {isfocus ? `${FOCUS_MIN} minutos` : `${BREAK_MIN} minutos`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
            style={{ background: 'var(--surface)', color: 'var(--text-muted)', boxShadow: 'var(--shadow-sm)' }}
            title="Reiniciar"
          >
            <RotateCcw size={18} />
          </button>
          <button
            onClick={() => setRunning(r => !r)}
            className="w-20 h-20 rounded-full flex items-center justify-center transition-transform hover:scale-105"
            style={{ background: accent, color: '#fff', boxShadow: 'var(--shadow-lg)' }}
            title={running ? 'Pausar' : 'Iniciar'}
          >
            {running ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" style={{ marginLeft: 4 }} />}
          </button>
          <button
            onClick={() => switchMode(isfocus ? 'break' : 'focus')}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-colors text-xs font-semibold"
            style={{ background: 'var(--surface)', color: 'var(--text-muted)', boxShadow: 'var(--shadow-sm)' }}
            title={isfocus ? 'Pular para pausa' : 'Pular para foco'}
          >
            {isfocus ? `${BREAK_MIN}m` : `${FOCUS_MIN}m`}
          </button>
        </div>

        <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
          {running ? 'Mantenha o foco. Você consegue.' : 'Pressione play para começar'}
        </p>
      </div>
    </div>
  )
}

function PomodoroMinimized({
  pomo, onExpand, onClose,
}: {
  pomo: ReturnType<typeof usePomodoro>
  onExpand: () => void
  onClose: () => void
}) {
  const { mode, remaining, running, setRunning } = pomo
  const isfocus = mode === 'focus'
  const total = (isfocus ? FOCUS_MIN : BREAK_MIN) * 60
  const progress = ((total - remaining) / total) * 100
  const accent = isfocus ? 'var(--primary)' : 'var(--success)'

  return (
    <div
      className="fixed bottom-6 left-6 z-40 rounded-2xl border flex items-center gap-3 px-3 py-2 transition-shadow hover:shadow-lg"
      style={{ background: 'var(--surface)', borderColor: accent, boxShadow: 'var(--shadow-md)' }}
    >
      <div className="relative w-10 h-10 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="18" cy="18" r="16" fill="none" stroke="var(--border)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="16" fill="none"
            stroke={accent} strokeWidth="3"
            strokeDasharray={`${(progress / 100) * 100} 100`}
            pathLength="100"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>{fmtTime(remaining)}</span>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold" style={{ color: accent }}>{isfocus ? 'Foco' : 'Pausa'}</p>
        <p className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{running ? 'em andamento' : 'pausado'}</p>
      </div>
      <button
        onClick={() => setRunning(r => !r)}
        className="w-7 h-7 rounded-full flex items-center justify-center"
        style={{ background: accent, color: '#fff' }}
        title={running ? 'Pausar' : 'Iniciar'}
      >
        {running ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
      </button>
      <button onClick={onExpand} className="w-7 h-7 rounded-md flex items-center justify-center" style={{ color: 'var(--text-muted)' }} title="Expandir">
        <Maximize2 size={12} />
      </button>
      <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center" style={{ color: 'var(--text-subtle)' }} title="Fechar">
        <X size={12} />
      </button>
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
const DURATION_PRESETS = [15, 30, 45, 60]

function QuickLogModal({ topics, onClose, onSaved }: {
  topics: (Topic & { subject: Subject })[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const toast = useToast()
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
    try {
      await supabase.from('study_logs').insert({
        topic_id: topicId,
        activity_type: activity,
        duration_minutes: duration ? parseInt(duration) : null,
        total_questions: activity === 'exercises' && totalNum > 0 ? totalNum : null,
        correct_answers: activity === 'exercises' && totalNum > 0 ? correctNum : null,
        studied_at: new Date().toISOString().split('T')[0],
      })

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
      toast.success('Estudo registrado!')
      onSaved()
    } catch (e: any) {
      toast.error('Erro ao registrar: ' + (e?.message || 'tente novamente'))
    } finally {
      setSaving(false)
    }
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
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Duração (min)</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {DURATION_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => setDuration(String(p))}
                  className="text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                  style={{
                    background: duration === String(p) ? 'var(--primary-soft)' : 'transparent',
                    borderColor: duration === String(p) ? 'var(--primary)' : 'var(--border)',
                    color: duration === String(p) ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                  }}
                >
                  {p}min
                </button>
              ))}
              <input type="number" min="1" placeholder="outro" value={duration} onChange={e => setDuration(e.target.value)} style={{ width: 80 }} />
            </div>
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
