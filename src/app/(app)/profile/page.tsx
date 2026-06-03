'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { PageSkeleton } from '@/components/Skeleton'
import { format, parseISO, subDays, startOfDay, eachDayOfInterval, isSameDay, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { User, Clock, Flame, BookMarked, CheckCircle2, RotateCw, Trash2, Pencil } from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'

interface LogRow { studied_at: string; duration_minutes: number | null; activity_type: string }

export default function ProfilePage() {
  const supabase = createClient()
  const { theme, toggle } = useTheme()
  const [name, setName] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [tempName, setTempName] = useState('')
  const [logs, setLogs] = useState<LogRow[]>([])
  const [examCount, setExamCount] = useState(0)
  const [subjectCount, setSubjectCount] = useState(0)
  const [topicCount, setTopicCount] = useState(0)
  const [completedTopics, setCompletedTopics] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<7 | 30 | 90>(30)

  // Load name from localStorage
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('user-name') : null
    setName(stored || 'Você')
  }, [])

  // Load stats
  useEffect(() => {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    (async () => {
      const [logsRes, examsRes, subjectsRes, topicsRes, completeRes, revRes] = await Promise.all([
        supabase.from('study_logs').select('studied_at, duration_minutes, activity_type').order('studied_at', { ascending: false }).limit(500),
        supabase.from('exams').select('id', { count: 'exact', head: true }).eq('is_watching', false),
        supabase.from('subjects').select('id', { count: 'exact', head: true }),
        supabase.from('topics').select('id', { count: 'exact', head: true }),
        supabase.from('topics').select('id', { count: 'exact', head: true }).not('completed_at', 'is', null),
        supabase.from('study_logs').select('id', { count: 'exact', head: true }).eq('activity_type', 'review'),
      ])
      setLogs((logsRes.data || []) as LogRow[])
      setExamCount(examsRes.count || 0)
      setSubjectCount(subjectsRes.count || 0)
      setTopicCount(topicsRes.count || 0)
      setCompletedTopics(completeRes.count || 0)
      setReviewCount(revRes.count || 0)
      setLoading(false)
    })()
  }, [])

  function saveName() {
    const trimmed = tempName.trim()
    if (trimmed) {
      localStorage.setItem('user-name', trimmed)
      setName(trimmed)
    }
    setEditing(false)
  }

  // Build daily totals
  const daily = useMemo(() => {
    const today = startOfDay(new Date())
    const days = eachDayOfInterval({ start: subDays(today, range - 1), end: today })
    return days.map(day => {
      const dayLogs = logs.filter(l => l.studied_at && isSameDay(parseISO(l.studied_at), day))
      const minutes = dayLogs.reduce((s, l) => s + (l.duration_minutes || 0), 0)
      return { day, minutes }
    })
  }, [logs, range])

  const totalMinutes = daily.reduce((s, d) => s + d.minutes, 0)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalRemMin = totalMinutes % 60
  const avgPerDay = Math.round(totalMinutes / range)
  const maxDay = Math.max(1, ...daily.map(d => d.minutes))

  // Streak (consecutive days with activity, ending today or yesterday)
  const streak = useMemo(() => {
    const today = startOfDay(new Date())
    let count = 0
    for (let i = 0; i < 365; i++) {
      const d = subDays(today, i)
      const has = logs.some(l => l.studied_at && isSameDay(parseISO(l.studied_at), d))
      if (has) count++
      else if (i > 0) break
      else continue // today might not have activity yet, allow start from yesterday
    }
    return count
  }, [logs])

  const lastStudy = useMemo(() => {
    if (logs.length === 0) return null
    return parseISO(logs[0].studied_at)
  }, [logs])

  function fmtMin(min: number) {
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h === 0) return `${m}min`
    if (m === 0) return `${h}h`
    return `${h}h ${m}min`
  }

  if (loading) return <PageSkeleton variant="list" />

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="rounded-2xl border p-6" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--primary-strong), var(--primary))', color: '#fff' }}
          >
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  value={tempName}
                  onChange={e => setTempName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveName()}
                  autoFocus
                  placeholder="Seu nome"
                  className="text-lg font-semibold"
                  style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text)' }}
                />
                <button onClick={saveName} className="text-xs px-3 py-1 rounded-md font-medium" style={{ background: 'var(--primary-strong)', color: '#fff' }}>Salvar</button>
                <button onClick={() => setEditing(false)} className="text-xs px-2 py-1" style={{ color: 'var(--text-subtle)' }}>Cancelar</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>{name}</h1>
                <button onClick={() => { setTempName(name === 'Você' ? '' : name); setEditing(true) }} className="p-1" style={{ color: 'var(--text-subtle)' }} title="Editar nome">
                  <Pencil size={13} />
                </button>
              </div>
            )}
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {lastStudy ? `Último estudo: ${format(lastStudy, "d 'de' MMM", { locale: ptBR })}` : 'Comece a estudar para ver suas estatísticas.'}
            </p>
          </div>
          <button
            onClick={toggle}
            className="text-xs px-3 py-2 rounded-lg border inline-flex items-center gap-1.5"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            Tema: {theme === 'dark' ? 'Escuro' : 'Claro'}
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Clock} label="Tempo total" value={`${totalHours}h ${totalRemMin}min`} note={`últimos ${range} dias`} />
        <StatCard icon={Flame} label="Sequência" value={`${streak}d`} note={streak > 0 ? 'dias seguidos' : 'comece hoje'} highlight={streak >= 7} />
        <StatCard icon={BookMarked} label="Tópicos" value={`${completedTopics}/${topicCount}`} note="concluídos" />
        <StatCard icon={RotateCw} label="Revisões" value={`${reviewCount}`} note="feitas no total" />
      </div>

      {/* Daily chart */}
      <div className="rounded-2xl border p-5" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Horas estudadas</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {totalMinutes > 0
                ? `Média de ${fmtMin(avgPerDay)}/dia · ${fmtMin(totalMinutes)} no período`
                : 'Nenhum tempo registrado ainda. Use o campo "Duração (min)" ao registrar estudos.'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {[7, 30, 90].map(r => (
              <button
                key={r}
                onClick={() => setRange(r as 7 | 30 | 90)}
                className="text-xs px-2.5 py-1 rounded-md border transition-colors"
                style={{
                  background: range === r ? 'var(--primary-soft)' : 'transparent',
                  borderColor: range === r ? 'var(--primary)' : 'var(--border)',
                  color: range === r ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                }}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-end gap-1" style={{ height: 140 }}>
          {daily.map(({ day, minutes }, i) => {
            const heightPct = (minutes / maxDay) * 100
            const isTodayDay = isSameDay(day, new Date())
            return (
              <div key={i} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end group">
                <div
                  className="w-full rounded-t-md transition-all relative"
                  style={{
                    height: minutes > 0 ? `${Math.max(heightPct, 4)}%` : '2px',
                    background: minutes > 0
                      ? (isTodayDay ? 'var(--primary-strong)' : 'var(--primary)')
                      : 'var(--border)',
                  }}
                  title={`${format(day, "d 'de' MMM", { locale: ptBR })}: ${fmtMin(minutes)}`}
                >
                  {minutes > 0 && (
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap" style={{ color: 'var(--text)' }}>
                      {fmtMin(minutes)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-2 flex justify-between text-xs" style={{ color: 'var(--text-subtle)' }}>
          <span>{format(daily[0]?.day || new Date(), "d MMM", { locale: ptBR })}</span>
          <span>{format(daily[daily.length - 1]?.day || new Date(), "d MMM", { locale: ptBR })}</span>
        </div>
      </div>

      {/* Overall stats */}
      <div className="rounded-2xl border p-5" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--text)' }}>Seu acervo</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Concursos</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{examCount}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>em estudo ativo</p>
          </div>
          <div className="border-l pl-6" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Matérias</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{subjectCount}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>cadastradas</p>
          </div>
          <div className="border-l pl-6" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Tópicos</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{topicCount}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>no total</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, note, highlight }: { icon: any; label: string; value: string; note?: string; highlight?: boolean }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: highlight ? 'var(--primary-soft)' : 'var(--surface)',
        borderColor: highlight ? 'var(--primary)' : 'var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} style={{ color: highlight ? 'var(--primary)' : 'var(--text-muted)' }} />
        <p className="text-xs uppercase tracking-wider" style={{ color: highlight ? 'var(--primary-soft-text)' : 'var(--text-muted)' }}>{label}</p>
      </div>
      <p className="text-2xl font-bold tabular-nums" style={{ color: highlight ? 'var(--primary-soft-text)' : 'var(--text)' }}>{value}</p>
      {note && <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{note}</p>}
    </div>
  )
}
