'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { useDataChanged } from '@/lib/events'
import { PageSkeleton } from '@/components/Skeleton'
import { Subject, Topic } from '@/lib/types'
import { format, parseISO, startOfWeek, differenceInCalendarWeeks } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Target, TrendingUp, CheckCircle2, AlertTriangle, PenLine, BarChart3 } from 'lucide-react'

interface QLog {
  total_questions: number
  correct_answers: number
  studied_at: string
  topic: (Topic & { subject: Subject }) | null
}

const PASS = 70 // linha de corte de "bom" (% de acerto)

export default function PerformancePage() {
  const supabase = createClient()
  const [logs, setLogs] = useState<QLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])
  useDataChanged(() => { load() })

  async function load() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const userId = await getUserId(supabase)
    if (!userId) { setLoading(false); return }
    const { data } = await supabase
      .from('study_logs')
      .select('total_questions, correct_answers, studied_at, topic:topics(*, subject:subjects(*))')
      .eq('user_id', userId)
      .not('total_questions', 'is', null)
      .gt('total_questions', 0)
      .order('studied_at', { ascending: true })
      .limit(3000)
    setLogs((data || []) as any)
    setLoading(false)
  }

  // Totais gerais
  const totals = useMemo(() => {
    let q = 0, c = 0
    for (const l of logs) { q += l.total_questions || 0; c += l.correct_answers || 0 }
    return { questions: q, correct: c, pct: q > 0 ? Math.round((c / q) * 100) : 0 }
  }, [logs])

  // Por matéria
  const bySubject = useMemo(() => {
    const map = new Map<string, { subject: Subject; q: number; c: number }>()
    for (const l of logs) {
      const s = l.topic?.subject
      if (!s) continue
      const cur = map.get(s.id) || { subject: s, q: 0, c: 0 }
      cur.q += l.total_questions || 0
      cur.c += l.correct_answers || 0
      map.set(s.id, cur)
    }
    return [...map.values()]
      .map(x => ({ ...x, pct: x.q > 0 ? Math.round((x.c / x.q) * 100) : 0 }))
      .sort((a, b) => b.q - a.q)
  }, [logs])

  const weakest = useMemo(
    () => bySubject.filter(s => s.q >= 5 && s.pct < PASS).sort((a, b) => a.pct - b.pct),
    [bySubject],
  )

  // Evolução por semana (% de acerto)
  const weekly = useMemo(() => {
    if (logs.length === 0) return [] as { label: string; pct: number; q: number }[]
    const map = new Map<string, { q: number; c: number; date: Date }>()
    for (const l of logs) {
      const d = startOfWeek(parseISO(l.studied_at), { weekStartsOn: 1 })
      const key = d.toISOString().split('T')[0]
      const cur = map.get(key) || { q: 0, c: 0, date: d }
      cur.q += l.total_questions || 0
      cur.c += l.correct_answers || 0
      map.set(key, cur)
    }
    return [...map.values()]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(-12)
      .map(x => ({ label: format(x.date, "d MMM", { locale: ptBR }), pct: x.q > 0 ? Math.round((x.c / x.q) * 100) : 0, q: x.q }))
  }, [logs])

  if (loading) return <PageSkeleton variant="default" />

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Desempenho em questões</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Seu acerto por matéria e a evolução ao longo do tempo</p>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            <BarChart3 size={28} strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>Sem questões registradas ainda</h2>
          <p className="text-sm max-w-xs" style={{ color: 'var(--text-muted)' }}>
            Registre estudos do tipo <strong>Exercícios</strong> com o total de questões e acertos para ver seu desempenho aqui.
          </p>
        </div>
      ) : (
        <>
          {/* Métricas grandes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard icon={<PenLine size={18} />} label="Questões resolvidas" value={totals.questions.toLocaleString('pt-BR')} accent="var(--primary)" soft="var(--primary-soft)" />
            <MetricCard
              icon={<Target size={18} />}
              label="Acerto geral"
              value={`${totals.pct}%`}
              accent={totals.pct >= PASS ? 'var(--success)' : 'var(--warning)'}
              soft={totals.pct >= PASS ? 'var(--success-soft)' : 'var(--warning-soft)'}
              sub={`${totals.correct.toLocaleString('pt-BR')} acertos`}
            />
            <MetricCard icon={<CheckCircle2 size={18} />} label="Matérias avaliadas" value={String(bySubject.length)} accent="var(--text-muted)" soft="var(--surface-hover)" />
          </div>

          {/* Evolução */}
          {weekly.length > 1 && <EvolutionChart weeks={weekly} />}

          {/* Pontos de atenção */}
          {weakest.length > 0 && (
            <div className="ef-card p-5" style={{ borderColor: 'var(--danger)' }}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} style={{ color: 'var(--danger)' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Matérias para reforçar</h3>
                <span className="text-xs">abaixo de {PASS}% de acerto</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {weakest.map(s => (
                  <span key={s.subject.id} className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: s.subject.color }} />
                    {s.subject.name} · <strong>{s.pct}%</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Acerto por matéria */}
          <div className="ef-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={16} style={{ color: 'var(--primary)' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Acerto por matéria</h3>
            </div>
            <div className="space-y-3.5">
              {bySubject.map(s => {
                const color = s.pct >= 85 ? 'var(--success)' : s.pct >= PASS ? 'var(--primary)' : s.pct >= 50 ? 'var(--warning)' : 'var(--danger)'
                return (
                  <div key={s.subject.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.subject.color }} />
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{s.subject.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs tabular-nums" style={{ color: 'var(--text-subtle)' }}>{s.c}/{s.q}</span>
                        <span className="text-sm font-bold tabular-nums" style={{ color }}>{s.pct}%</span>
                      </div>
                    </div>
                    <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
                      <div className="h-2.5 rounded-full transition-all duration-500" style={{ width: `${s.pct}%`, background: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MetricCard({ icon, label, value, sub, accent, soft }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent: string; soft: string }) {
  return (
    <div className="ef-card p-5">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: soft, color: accent }}>{icon}</div>
      <p className="text-3xl font-bold tabular-nums" style={{ color: 'var(--text)' }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{sub}</p>}
    </div>
  )
}

function EvolutionChart({ weeks }: { weeks: { label: string; pct: number; q: number }[] }) {
  const w = 640, h = 160, padX = 8, padY = 16
  const n = weeks.length
  const stepX = n > 1 ? (w - padX * 2) / (n - 1) : 0
  const y = (pct: number) => padY + (1 - pct / 100) * (h - padY * 2)
  const pts = weeks.map((wk, i) => ({ x: padX + i * stepX, y: y(wk.pct), ...wk }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L ${pts[n - 1].x.toFixed(1)} ${h - padY} L ${pts[0].x.toFixed(1)} ${h - padY} Z`

  return (
    <div className="ef-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={16} style={{ color: 'var(--primary)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Evolução do acerto</h3>
        <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>· por semana</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 160 }} preserveAspectRatio="none">
        {/* linhas guia 50% e 70% */}
        {[50, PASS].map(g => (
          <g key={g}>
            <line x1={padX} x2={w - padX} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth={1} strokeDasharray="4 4" />
          </g>
        ))}
        <path d={area} fill="color-mix(in srgb, var(--primary) 14%, transparent)" />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill="var(--surface)" stroke="var(--primary)" strokeWidth={2} />
            <title>{p.label}: {p.pct}% ({p.q} questões)</title>
          </g>
        ))}
      </svg>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{weeks[0].label}</span>
        <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{weeks[weeks.length - 1].label}</span>
      </div>
    </div>
  )
}
