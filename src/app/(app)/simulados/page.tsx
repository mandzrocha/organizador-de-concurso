'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'
import { PageSkeleton } from '@/components/Skeleton'
import { useDataChanged, emitDataChanged } from '@/lib/events'
import { Exam, MockExam } from '@/lib/types'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, X, Trophy, Target, TrendingUp, Trash2, Pencil, Calendar, AlertTriangle } from 'lucide-react'

const PASS = 70 // linha de corte de "bom"

export default function SimuladosPage() {
  const supabase = createClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [items, setItems] = useState<MockExam[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<MockExam | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => { load() }, [])
  useDataChanged(() => { load() })

  async function load() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const userId = await getUserId(supabase)
    if (!userId) { setLoading(false); return }
    const [mockRes, enrollRes] = await Promise.all([
      supabase.from('mock_exams').select('*, exam:exams(*)').eq('user_id', userId).order('taken_at', { ascending: false }),
      supabase.from('user_exams').select('exam:exams(*)').eq('user_id', userId),
    ])
    // 404/PGRST205 = tabela ainda não criada no Supabase
    setNeedsSetup(!!mockRes.error)
    setItems((mockRes.data || []) as any)
    setExams(((enrollRes.data || []).map((r: any) => r.exam).filter(Boolean)) as Exam[])
    setLoading(false)
  }

  async function remove(item: MockExam) {
    const ok = await confirm({
      title: 'Excluir simulado?',
      message: `"${item.title}" será removido do seu histórico.`,
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('mock_exams').delete().eq('id', item.id)
    if (error) { toast.error('Erro ao excluir: ' + error.message); return }
    toast.success('Simulado excluído')
    emitDataChanged()
    load()
  }

  // Métricas
  const stats = useMemo(() => {
    if (items.length === 0) return null
    const totalQ = items.reduce((s, i) => s + i.total_questions, 0)
    const totalC = items.reduce((s, i) => s + i.correct_answers, 0)
    const avg = totalQ > 0 ? Math.round((totalC / totalQ) * 100) : 0
    const best = Math.max(...items.map(i => i.total_questions > 0 ? Math.round((i.correct_answers / i.total_questions) * 100) : 0))
    return { count: items.length, avg, best, totalQ }
  }, [items])

  // Evolução (ordem cronológica)
  const chrono = useMemo(() => [...items].reverse(), [items])

  if (loading) return <PageSkeleton variant="list" />

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Simulados</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Registre seus simulados e acompanhe a evolução</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--primary-strong)', color: '#fff' }}
        >
          <Plus size={14} strokeWidth={2.5} /> Novo simulado
        </button>
      </div>

      {needsSetup && (
        <div className="rounded-2xl border p-4 flex items-start gap-3" style={{ background: 'var(--warning-soft)', borderColor: 'var(--warning)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--warning)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm" style={{ color: 'var(--text)' }}>
            <p className="font-semibold" style={{ color: 'var(--warning)' }}>Falta criar a tabela no banco</p>
            <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Rode o arquivo <code className="px-1 rounded" style={{ background: 'var(--surface-hover)' }}>supabase-metas-simulados.sql</code> no
              SQL Editor do Supabase (uma vez). Sem isso os simulados não são salvos.
            </p>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            <Trophy size={30} strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>Nenhum simulado registrado</h2>
          <p className="text-sm mb-6 max-w-xs" style={{ color: 'var(--text-muted)' }}>
            Fez um simulado? Registre a nota e os acertos para acompanhar sua evolução ao longo do tempo.
          </p>
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
            <Plus size={14} strokeWidth={2.5} /> Registrar primeiro simulado
          </button>
        </div>
      ) : (
        <>
          {/* Métricas */}
          {stats && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Metric icon={<Target size={18} />} label="Média de acerto" value={`${stats.avg}%`} accent={stats.avg >= PASS ? 'var(--success)' : 'var(--warning)'} soft={stats.avg >= PASS ? 'var(--success-soft)' : 'var(--warning-soft)'} />
              <Metric icon={<Trophy size={18} />} label="Melhor resultado" value={`${stats.best}%`} accent="var(--primary)" soft="var(--primary-soft)" />
              <Metric icon={<TrendingUp size={18} />} label="Simulados feitos" value={String(stats.count)} accent="var(--text-muted)" soft="var(--surface-hover)" sub={`${stats.totalQ.toLocaleString('pt-BR')} questões`} />
            </div>
          )}

          {/* Evolução */}
          {chrono.length > 1 && <EvolutionChart items={chrono} />}

          {/* Lista */}
          <div className="space-y-2">
            {items.map(item => {
              const pct = item.total_questions > 0 ? Math.round((item.correct_answers / item.total_questions) * 100) : 0
              const color = pct >= 85 ? 'var(--success)' : pct >= PASS ? 'var(--primary)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)'
              return (
                <div key={item.id} className="ef-card p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-hover)' }}>
                    <span className="text-sm font-bold tabular-nums leading-none" style={{ color }}>{pct}%</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{item.title}</p>
                    <div className="flex items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
                      <span className="inline-flex items-center gap-1"><Calendar size={11} /> {format(parseISO(item.taken_at), "d 'de' MMM yyyy", { locale: ptBR })}</span>
                      <span className="tabular-nums">{item.correct_answers}/{item.total_questions} acertos</span>
                      {item.banca && <span>· {item.banca}</span>}
                      {item.exam?.name && <span>· {item.exam.name}</span>}
                    </div>
                    {item.notes && <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-subtle)' }}>{item.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => { setEditing(item); setShowForm(true) }} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surface-hover)]" style={{ color: 'var(--text-subtle)' }} title="Editar">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => remove(item)} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--danger-soft)]" style={{ color: 'var(--text-subtle)' }} title="Excluir">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {showForm && (
        <MockExamForm
          exams={exams}
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); emitDataChanged(); load() }}
        />
      )}
    </div>
  )
}

function Metric({ icon, label, value, sub, accent, soft }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent: string; soft: string }) {
  return (
    <div className="ef-card p-5">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: soft, color: accent }}>{icon}</div>
      <p className="text-3xl font-bold tabular-nums" style={{ color: 'var(--text)' }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{sub}</p>}
    </div>
  )
}

function EvolutionChart({ items }: { items: MockExam[] }) {
  const data = items.map(i => ({
    pct: i.total_questions > 0 ? Math.round((i.correct_answers / i.total_questions) * 100) : 0,
    label: format(parseISO(i.taken_at), 'd MMM', { locale: ptBR }),
  }))
  const w = 640, h = 160, padX = 8, padY = 16
  const n = data.length
  const stepX = n > 1 ? (w - padX * 2) / (n - 1) : 0
  const y = (pct: number) => padY + (1 - pct / 100) * (h - padY * 2)
  const pts = data.map((d, i) => ({ x: padX + i * stepX, y: y(d.pct), ...d }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L ${pts[n - 1].x.toFixed(1)} ${h - padY} L ${pts[0].x.toFixed(1)} ${h - padY} Z`

  return (
    <div className="ef-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={16} style={{ color: 'var(--primary)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Evolução dos simulados</h3>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 160 }} preserveAspectRatio="none">
        {[50, PASS].map(g => (
          <line key={g} x1={padX} x2={w - padX} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth={1} strokeDasharray="4 4" />
        ))}
        <path d={area} fill="color-mix(in srgb, var(--primary) 14%, transparent)" />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill="var(--surface)" stroke="var(--primary)" strokeWidth={2} />
            <title>{p.label}: {p.pct}%</title>
          </g>
        ))}
      </svg>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{data[0].label}</span>
        <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{data[data.length - 1].label}</span>
      </div>
    </div>
  )
}

function MockExamForm({ exams, editing, onClose, onSaved }: {
  exams: Exam[]
  editing: MockExam | null
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const toast = useToast()
  const [title, setTitle] = useState(editing?.title || '')
  const [examId, setExamId] = useState(editing?.exam_id || '')
  const [banca, setBanca] = useState(editing?.banca || '')
  const [takenAt, setTakenAt] = useState(editing?.taken_at || new Date().toISOString().split('T')[0])
  const [total, setTotal] = useState(editing ? String(editing.total_questions) : '')
  const [correct, setCorrect] = useState(editing ? String(editing.correct_answers) : '')
  const [duration, setDuration] = useState(editing?.duration_minutes ? String(editing.duration_minutes) : '')
  const [notes, setNotes] = useState(editing?.notes || '')
  const [saving, setSaving] = useState(false)

  const totalNum = parseInt(total) || 0
  const correctNum = parseInt(correct) || 0
  const canSave = title.trim() && totalNum > 0 && correctNum >= 0 && correctNum <= totalNum

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      const userId = await getUserId(supabase)
      if (!userId) { toast.error('Sua sessão expirou. Faça login novamente.'); setSaving(false); return }
      const payload = {
        user_id: userId,
        exam_id: examId || null,
        title: title.trim(),
        banca: banca.trim() || null,
        taken_at: takenAt,
        total_questions: totalNum,
        correct_answers: correctNum,
        duration_minutes: duration ? parseInt(duration) : null,
        notes: notes.trim() || null,
      }
      const { error } = editing
        ? await supabase.from('mock_exams').update(payload).eq('id', editing.id)
        : await supabase.from('mock_exams').insert(payload)
      if (error) throw error
      toast.success(editing ? 'Simulado atualizado!' : 'Simulado registrado!')
      onSaved()
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message || 'tente novamente'))
    } finally {
      setSaving(false)
    }
  }

  const pct = totalNum > 0 ? Math.round((correctNum / totalNum) * 100) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', maxHeight: '90vh' }}>
        <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{editing ? 'Editar simulado' : 'Novo simulado'}</h2>
          <button onClick={onClose} style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Título *</label>
            <input type="text" placeholder="Ex: Simulado TJSP 01" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Total de questões *</label>
              <input type="number" min="1" placeholder="100" value={total} onChange={e => setTotal(e.target.value)} />
            </div>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Acertos *</label>
              <input type="number" min="0" max={total || undefined} placeholder="72" value={correct} onChange={e => setCorrect(e.target.value)} />
            </div>
          </div>

          {pct !== null && (
            <div className="text-center py-2 rounded-lg" style={{ background: 'var(--surface-hover)' }}>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Aproveitamento: </span>
              <span className="text-lg font-bold tabular-nums" style={{ color: pct >= PASS ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{pct}%</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Data</label>
              <input type="date" value={takenAt} onChange={e => setTakenAt(e.target.value)} />
            </div>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Duração (min)</label>
              <input type="number" min="1" placeholder="240" value={duration} onChange={e => setDuration(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Concurso</label>
              <select value={examId} onChange={e => setExamId(e.target.value)}>
                <option value="">— Nenhum —</option>
                {exams.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Banca</label>
              <input type="text" placeholder="Ex: Vunesp" value={banca} onChange={e => setBanca(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Anotações</label>
            <textarea placeholder="O que errou, o que revisar..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <div className="px-5 pb-5 pt-3 border-t flex gap-3" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Cancelar</button>
          <button onClick={save} disabled={!canSave || saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
            {saving ? 'Salvando...' : editing ? 'Salvar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
