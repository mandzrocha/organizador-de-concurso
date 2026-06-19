'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'
import { PageSkeleton } from '@/components/Skeleton'
import { useDataChanged, emitDataChanged } from '@/lib/events'
import { Dropdown } from '@/components/Dropdown'
import { Subject, Topic, ErrorNote } from '@/lib/types'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { NotebookPen, AlertTriangle, TrendingDown, Plus, X, Check, Trash2, Sparkles } from 'lucide-react'

const PASS = 70
const MIN_SAMPLE = 5 // mínimo de questões para considerar ponto fraco

interface WeakPoint {
  topic: Topic & { subject?: Subject }
  pct: number | null      // % de acerto (null se só veio do SM-2)
  questions: number
  hard: boolean           // difícil nas revisões (SM-2)
}

export default function CadernoPage() {
  const supabase = createClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [weak, setWeak] = useState<WeakPoint[]>([])
  const [notes, setNotes] = useState<ErrorNote[]>([])
  const [topics, setTopics] = useState<(Topic & { subject: Subject })[]>([])
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

  useEffect(() => { load() }, [])
  useDataChanged(() => { load() })

  async function load() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const userId = await getUserId(supabase)
    if (!userId) { setLoading(false); return }

    const { data: enr } = await supabase.from('user_exams').select('exam_id').eq('user_id', userId)
    const examIds = (enr || []).map((e: any) => e.exam_id)

    const [logsRes, critRes, notesRes, topicsRes] = await Promise.all([
      supabase.from('study_logs')
        .select('total_questions, correct_answers, topic:topics(*, subject:subjects(*))')
        .eq('user_id', userId).not('total_questions', 'is', null).gt('total_questions', 0).limit(3000),
      supabase.from('revision_schedule')
        .select('ease_factor, repetitions, topic:topics(*, subject:subjects(*))')
        .eq('user_id', userId).lt('ease_factor', 1.7).gt('repetitions', 0),
      supabase.from('error_notes').select('*, subject:subjects(*), topic:topics(*, subject:subjects(*))').eq('user_id', userId).order('created_at', { ascending: false }),
      examIds.length ? supabase.from('topics').select('*, subject:subjects(*)').in('exam_id', examIds) : Promise.resolve({ data: [] as any }),
    ])

    // Agrega acerto por tópico
    const acc = new Map<string, { topic: any; q: number; c: number }>()
    for (const l of (logsRes.data || []) as any[]) {
      if (!l.topic) continue
      const cur = acc.get(l.topic.id) || { topic: l.topic, q: 0, c: 0 }
      cur.q += l.total_questions || 0
      cur.c += l.correct_answers || 0
      acc.set(l.topic.id, cur)
    }
    const wp = new Map<string, WeakPoint>()
    for (const { topic, q, c } of acc.values()) {
      const pct = q > 0 ? Math.round((c / q) * 100) : 0
      if (q >= MIN_SAMPLE && pct < PASS) wp.set(topic.id, { topic, pct, questions: q, hard: false })
    }
    // Tópicos difíceis no SM-2
    for (const r of (critRes.data || []) as any[]) {
      if (!r.topic) continue
      const ex = wp.get(r.topic.id)
      if (ex) ex.hard = true
      else wp.set(r.topic.id, { topic: r.topic, pct: null, questions: 0, hard: true })
    }

    setWeak([...wp.values()].sort((a, b) => (a.pct ?? 200) - (b.pct ?? 200)))
    setNeedsSetup(!!notesRes.error)
    setNotes(((notesRes.data || []) as any).filter((n: any) => n))
    setTopics((topicsRes.data || []) as any)
    setLoading(false)
  }

  async function toggleResolved(note: ErrorNote) {
    const { error } = await supabase.from('error_notes').update({ resolved: !note.resolved }).eq('id', note.id)
    if (error) { toast.error('Erro ao atualizar: ' + error.message); return }
    load()
  }

  async function removeNote(note: ErrorNote) {
    const ok = await confirm({ title: 'Excluir anotação?', message: 'Essa anotação de erro será removida.', confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    const { error } = await supabase.from('error_notes').delete().eq('id', note.id)
    if (error) { toast.error('Erro ao excluir: ' + error.message); return }
    toast.success('Anotação excluída'); load()
  }

  const visibleNotes = useMemo(() => notes.filter(n => showResolved || !n.resolved), [notes, showResolved])
  const resolvedCount = useMemo(() => notes.filter(n => n.resolved).length, [notes])

  if (loading) return <PageSkeleton variant="list" />

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Caderno de erros</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Seus pontos fracos e anotações do que revisar</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
          <Plus size={14} strokeWidth={2.5} /> Anotar erro
        </button>
      </div>

      {needsSetup && (
        <div className="rounded-2xl border p-4 flex items-start gap-3" style={{ background: 'var(--warning-soft)', borderColor: 'var(--warning)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--warning)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm" style={{ color: 'var(--text)' }}>
            <p className="font-semibold" style={{ color: 'var(--warning)' }}>Falta criar a tabela no banco</p>
            <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Rode <code className="px-1 rounded" style={{ background: 'var(--surface-hover)' }}>supabase-caderno-erros.sql</code> no SQL Editor do Supabase para salvar anotações. Os pontos fracos abaixo já funcionam.
            </p>
          </div>
        </div>
      )}

      {/* Pontos fracos automáticos */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown size={16} style={{ color: 'var(--danger)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Pontos fracos</h2>
          <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>· detectados automaticamente</span>
        </div>
        {weak.length === 0 ? (
          <div className="ef-card p-8 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
              <Sparkles size={26} strokeWidth={1.5} />
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Nenhum ponto fraco no momento. Resolva questões (tipo <strong>Exercícios</strong>) e faça revisões para o sistema identificar onde reforçar.
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            {weak.map(w => (
              <div key={w.topic.id} className="ef-card p-4 flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: w.topic.subject?.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{w.topic.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{w.topic.subject?.name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {w.pct != null && (
                    <span className="text-xs font-semibold px-2 py-1 rounded-md tabular-nums" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{w.pct}% acerto</span>
                  )}
                  {w.hard && (
                    <span className="text-xs font-semibold px-2 py-1 rounded-md" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>difícil</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Anotações manuais */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <NotebookPen size={16} style={{ color: 'var(--primary)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Minhas anotações</h2>
          </div>
          {resolvedCount > 0 && (
            <button onClick={() => setShowResolved(v => !v)} className="text-xs" style={{ color: 'var(--primary-strong)' }}>
              {showResolved ? 'Ocultar resolvidos' : `Mostrar resolvidos (${resolvedCount})`}
            </button>
          )}
        </div>
        {visibleNotes.length === 0 ? (
          <div className="ef-card p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {notes.length === 0 ? 'Nenhuma anotação ainda. Clique em "Anotar erro" para registrar o que precisa revisar.' : 'Nada por aqui — tudo resolvido! 🎉'}
          </div>
        ) : (
          <div className="grid gap-2">
            {visibleNotes.map(n => (
              <div key={n.id} className="ef-card p-4 flex items-start gap-3">
                <button
                  onClick={() => toggleResolved(n)}
                  className="w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                  style={{ background: n.resolved ? 'var(--success)' : 'transparent', borderColor: n.resolved ? 'var(--success)' : 'var(--border-strong)' }}
                  title={n.resolved ? 'Marcar como não resolvido' : 'Marcar como resolvido'}
                >
                  {n.resolved && <Check size={12} strokeWidth={3} className="text-white" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: n.resolved ? 'var(--text-subtle)' : 'var(--text)', textDecoration: n.resolved ? 'line-through' : 'none' }}>{n.content}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs flex-wrap" style={{ color: 'var(--text-subtle)' }}>
                    {(n.subject || n.topic?.subject) && (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: (n.subject || n.topic?.subject)?.color }} />
                        {(n.subject || n.topic?.subject)?.name}
                        {n.topic && <span style={{ color: 'var(--text-subtle)' }}> › {n.topic.name}</span>}
                      </span>
                    )}
                    {!n.subject && !n.topic && <span>Sem matéria</span>}
                    <span>· {format(parseISO(n.created_at), "d 'de' MMM", { locale: ptBR })}</span>
                  </div>
                </div>
                <button onClick={() => removeNote(n)} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors hover:bg-[var(--danger-soft)]" style={{ color: 'var(--text-subtle)' }} title="Excluir">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {showForm && (
        <NoteForm topics={topics} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); emitDataChanged(); load() }} />
      )}
    </div>
  )
}

function NoteForm({ topics, onClose, onSaved }: {
  topics: (Topic & { subject: Subject })[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const toast = useToast()
  const [content, setContent] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [saving, setSaving] = useState(false)

  // Matérias disponíveis (a partir dos tópicos), em ordem alfabética
  const subjects = useMemo(() => {
    const map = new Map<string, Subject>()
    for (const t of topics) if (t.subject) map.set(t.subject.id, t.subject)
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [topics])

  // Tópicos da matéria selecionada, em ordem alfabética
  const topicsForSubject = useMemo(() => {
    if (!subjectId) return []
    return topics.filter(t => t.subject?.id === subjectId).sort((a, b) => a.name.localeCompare(b.name))
  }, [topics, subjectId])

  function changeSubject(v: string) {
    setSubjectId(v)
    setTopicId('') // troca de matéria zera o tópico
  }

  async function save() {
    if (!content.trim()) return
    setSaving(true)
    try {
      const userId = await getUserId(supabase)
      if (!userId) { toast.error('Sua sessão expirou. Faça login novamente.'); setSaving(false); return }
      const { error } = await supabase.from('error_notes').insert({
        user_id: userId,
        subject_id: subjectId || null,
        topic_id: topicId || null,
        content: content.trim(),
      })
      if (error) throw error
      toast.success('Anotação salva!')
      onSaved()
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message || 'tente novamente'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Anotar erro</h2>
          <button onClick={onClose} style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>O que você errou / precisa revisar? *</label>
            <textarea placeholder="Ex: Confundi prescrição e decadência em Direito Civil..." value={content} onChange={e => setContent(e.target.value)} rows={3} autoFocus />
          </div>
          {subjects.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Matéria (opcional)</label>
                <Dropdown
                  value={subjectId}
                  onChange={changeSubject}
                  placeholder="— Nenhuma —"
                  options={[
                    { value: '', label: '— Nenhuma —' },
                    ...subjects.map(s => ({ value: s.id, label: s.name, color: s.color })),
                  ]}
                />
              </div>
              <div>
                <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Tópico (opcional)</label>
                <Dropdown
                  value={topicId}
                  onChange={setTopicId}
                  disabled={!subjectId}
                  placeholder={subjectId ? '— Toda a matéria —' : 'Escolha a matéria antes'}
                  options={[
                    { value: '', label: subjectId ? '— Toda a matéria —' : 'Escolha a matéria antes' },
                    ...topicsForSubject.map(t => ({ value: t.id, label: t.name })),
                  ]}
                />
              </div>
            </div>
          )}
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Cancelar</button>
          <button onClick={save} disabled={!content.trim() || saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
