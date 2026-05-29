'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Exam, SUBJECT_COLORS } from '@/lib/types'
import { isSupabaseConfigured } from '@/lib/config'
import type { SubjectDiff, EditalDiff } from '@/app/api/compare-edital/route'

type TabKey = 'info' | 'edital'

export default function EditExamPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [exam, setExam] = useState<Exam | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('info')

  // Info form
  const [form, setForm] = useState({ name: '', organization: '', exam_date: '', description: '', is_primary: false, pre_edital: false })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Edital diff
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [comparing, setComparing] = useState(false)
  const [diff, setDiff] = useState<EditalDiff | null>(null)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  useEffect(() => { loadExam() }, [id])

  async function loadExam() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const { data } = await supabase.from('exams').select('*').eq('id', id).single()
    if (!data) { router.push('/exams'); return }
    setExam(data)
    setForm({
      name: data.name,
      organization: data.organization || '',
      exam_date: data.exam_date || '',
      description: data.description || '',
      is_primary: data.is_primary,
      pre_edital: !data.exam_date,
    })
    setLoading(false)
  }

  async function saveInfo() {
    setSaving(true)
    setSaveMsg('')
    await supabase.from('exams').update({
      name: form.name,
      organization: form.organization || null,
      description: form.description || null,
      is_primary: form.is_primary,
      exam_date: form.pre_edital ? null : (form.exam_date || null),
    }).eq('id', id)

    if (form.is_primary) {
      await supabase.from('exams').update({ is_primary: false }).neq('id', id)
      await supabase.from('exams').update({ is_primary: true }).eq('id', id)
    }

    setSaving(false)
    setSaveMsg('Salvo!')
    setTimeout(() => setSaveMsg(''), 2000)
    loadExam()
  }

  async function comparePdf() {
    if (!pdfFile) return
    setComparing(true)
    setError('')
    setDiff(null)
    setApplied(false)

    try {
      const formData = new FormData()
      formData.append('file', pdfFile)
      formData.append('examId', id)
      const res = await fetch('/api/compare-edital', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao comparar')
      setDiff(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setComparing(false)
    }
  }

  async function applyDiff() {
    if (!diff) return
    setApplying(true)
    setError('')

    try {
      for (let si = 0; si < diff.subjects.length; si++) {
        const sub = diff.subjects[si]
        if (sub.status === 'removed') continue // don't remove automatically

        let subjectId: string

        if (sub.status === 'new') {
          // Create new subject
          const { data: newSub } = await supabase
            .from('subjects')
            .insert({ name: sub.name, color: SUBJECT_COLORS[si % SUBJECT_COLORS.length] })
            .select().single()
          subjectId = newSub!.id
          await supabase.from('exam_subjects').upsert({ exam_id: id, subject_id: subjectId })
        } else {
          // existing subject - use existingId
          subjectId = sub.existingId!
        }

        // Handle topics
        const newTopics = sub.topics.filter(t => t.status === 'new')
        if (newTopics.length > 0) {
          const { data: existing } = await supabase
            .from('topics')
            .select('order_index')
            .eq('subject_id', subjectId)
            .order('order_index', { ascending: false })
            .limit(1)

          const startIndex = (existing?.[0]?.order_index ?? -1) + 1
          await supabase.from('topics').insert(
            newTopics.map((t, i) => ({
              subject_id: subjectId,
              name: t.name,
              order_index: startIndex + i,
              exam_id: null,
            }))
          )
        }
      }

      // Update exam_date if form was set to have date
      if (!form.pre_edital && form.exam_date) {
        await supabase.from('exams').update({ exam_date: form.exam_date }).eq('id', id)
      }

      setApplied(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}><p className="text-sm">Carregando...</p></div>
  if (!exam) {
    // Not configured or not found — show shell for preview
    if (!isSupabaseConfigured()) {
      return (
        <div className="p-6 max-w-3xl mx-auto space-y-5">
          <div>
            <Link href="/exams" className="text-xs block mb-2" style={{ color: 'var(--text-muted)' }}>← Voltar</Link>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Editar concurso</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>Configure o Supabase para usar esta página.</p>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <Link href={`/exams/${id}`} className="text-xs block mb-2" style={{ color: 'var(--text-muted)' }}>← Voltar ao concurso</Link>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Editar concurso</h1>
        <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{exam.name}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-elevated)' }}>
        {([['info', 'Informações'], ['edital', 'Atualizar edital']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: tab === key ? 'var(--primary-soft)' : 'transparent',
              color: tab === key ? 'var(--primary-soft-text)' : 'var(--text-muted)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Info */}
      {tab === 'info' && (
        <div className="rounded-xl border p-6 space-y-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Nome do concurso *</label>
            <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Órgão / Banca</label>
            <input type="text" value={form.organization} onChange={e => setForm(p => ({ ...p, organization: e.target.value }))} placeholder="Ex: TJSP, TRF1, Vunesp..." />
          </div>

          {/* Date / pre-edital */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Data da prova</label>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <div
                onClick={() => setForm(p => ({ ...p, pre_edital: !p.pre_edital, exam_date: !p.pre_edital ? '' : p.exam_date }))}
                className="w-8 h-4 rounded-full relative transition-colors flex-shrink-0"
                style={{ background: form.pre_edital ? 'var(--warning)' : 'var(--border)' }}
              >
                <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all" style={{ left: form.pre_edital ? '17px' : '2px' }} />
              </div>
              <span className="text-xs" style={{ color: form.pre_edital ? 'var(--warning)' : 'var(--text-muted)' }}>
                Ainda não tem edital publicado — estudando com edital anterior
              </span>
            </label>
            {form.pre_edital ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--warning-soft)', border: '1px solid #3a2e10' }}>
                <span className="text-sm">📂</span>
                <p className="text-xs" style={{ color: 'var(--warning)' }}>Sem data definida. Adicione a data assim que o edital for publicado.</p>
              </div>
            ) : (
              <input type="date" value={form.exam_date} onChange={e => setForm(p => ({ ...p, exam_date: e.target.value }))} />
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Descrição (opcional)</label>
            <textarea rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Cargo, observações..." style={{ resize: 'none' }} />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => setForm(p => ({ ...p, is_primary: !p.is_primary }))}
              className="w-9 h-5 rounded-full relative transition-colors"
              style={{ background: form.is_primary ? 'var(--primary-strong)' : 'var(--border)' }}
            >
              <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: form.is_primary ? '18px' : '2px' }} />
            </div>
            <span className="text-sm" style={{ color: 'var(--text)' }}>Definir como concurso foco principal</span>
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={saveInfo}
              disabled={saving || !form.name.trim()}
              className="px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{ background: 'var(--primary-strong)', color: '#fff' }}
            >
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
            {saveMsg && <span className="text-sm" style={{ color: 'var(--success)' }}>✓ {saveMsg}</span>}
          </div>
        </div>
      )}

      {/* Tab: Atualizar edital */}
      {tab === 'edital' && (
        <div className="space-y-4">
          <div className="rounded-xl border p-5 space-y-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div>
              <h2 className="text-sm font-medium" style={{ color: 'var(--text)' }}>Novo edital publicado?</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Faça o upload do PDF do novo edital. A IA vai comparar com o conteúdo atual e mostrar o que mudou — matérias adicionadas, removidas e tópicos novos.
              </p>
            </div>

            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors hover:border-indigo-500"
              style={{ borderColor: pdfFile ? 'var(--primary-strong)' : 'var(--border)' }}
            >
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => { setPdfFile(e.target.files?.[0] || null); setDiff(null); setApplied(false) }} />
              <div className="text-2xl mb-1">{pdfFile ? '📄' : '⬆️'}</div>
              {pdfFile ? (
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{pdfFile.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{(pdfFile.size / 1024 / 1024).toFixed(2)} MB · Clique para trocar</p>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Clique para selecionar o PDF do novo edital</p>
              )}
            </div>

            {error && <div className="p-3 rounded-lg text-sm" style={{ background: '#2a1a1a', color: '#f87171' }}>{error}</div>}

            {pdfFile && !diff && (
              <button
                onClick={comparePdf}
                disabled={comparing}
                className="w-full py-2.5 rounded-lg text-sm font-medium disabled:opacity-60"
                style={{ background: 'var(--primary-strong)', color: '#fff' }}
              >
                {comparing ? '⏳ Analisando e comparando...' : '🔍 Comparar com edital atual'}
              </button>
            )}
          </div>

          {/* Diff result */}
          {diff && (
            <DiffView
              diff={diff}
              applied={applied}
              applying={applying}
              onApply={applyDiff}
              onReset={() => { setDiff(null); setPdfFile(null); setApplied(false) }}
              onGoBack={() => router.push(`/exams/${id}`)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function DiffView({ diff, applied, applying, onApply, onReset, onGoBack }: {
  diff: EditalDiff
  applied: boolean
  applying: boolean
  onApply: () => void
  onReset: () => void
  onGoBack: () => void
}) {
  const { summary } = diff
  const hasChanges = summary.newSubjects > 0 || summary.removedSubjects > 0 || summary.newTopics > 0 || summary.removedTopics > 0

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="rounded-xl border p-4 grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <SummaryChip label="Matérias novas" value={summary.newSubjects} color="#22c55e" />
        <SummaryChip label="Matérias removidas" value={summary.removedSubjects} color="#f87171" />
        <SummaryChip label="Tópicos novos" value={summary.newTopics} color="#22c55e" />
        <SummaryChip label="Tópicos removidos" value={summary.removedTopics} color="#f87171" />
      </div>

      {!hasChanges && (
        <div className="rounded-xl border p-6 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="text-3xl mb-2">✅</div>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Nenhuma mudança detectada!</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>O novo edital tem o mesmo conteúdo programático.</p>
        </div>
      )}

      {/* Per-subject diff */}
      {diff.subjects.map((sub, i) => (
        <SubjectDiffCard key={i} subject={sub} />
      ))}

      {/* Action buttons */}
      {!applied && hasChanges && (
        <div className="rounded-xl border p-4 flex items-start gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Aplicar alterações?</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Serão adicionados {summary.newTopics} tópico{summary.newTopics !== 1 ? 's' : ''} e {summary.newSubjects} matéria{summary.newSubjects !== 1 ? 's' : ''} novas.
              {summary.removedSubjects > 0 || summary.removedTopics > 0
                ? ` Itens removidos não são excluídos automaticamente — você pode remover manualmente se quiser.`
                : ''}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={onReset} className="px-3 py-2 rounded-lg text-xs border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              Cancelar
            </button>
            <button
              onClick={onApply}
              disabled={applying}
              className="px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-50"
              style={{ background: 'var(--primary-strong)', color: '#fff' }}
            >
              {applying ? 'Aplicando...' : '✓ Aplicar mudanças'}
            </button>
          </div>
        </div>
      )}

      {applied && (
        <div className="rounded-xl border p-4 flex items-center justify-between" style={{ background: 'var(--surface)', borderColor: '#22c55e' }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🎉</span>
            <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>Alterações aplicadas com sucesso!</p>
          </div>
          <button onClick={onGoBack} className="px-4 py-2 rounded-lg text-xs font-medium" style={{ background: '#1a2a1a', color: 'var(--success)' }}>
            Ver concurso atualizado →
          </button>
        </div>
      )}
    </div>
  )
}

function SummaryChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold" style={{ color: value > 0 ? color : '#555568' }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  )
}

function SubjectDiffCard({ subject }: { subject: SubjectDiff }) {
  const [expanded, setExpanded] = useState(subject.status === 'new' || subject.topics.some(t => t.status !== 'existing'))

  const statusConfig = {
    new: { bg: '#0f2a0f', border: '#1a4a1a', badge: { bg: '#14532d', color: 'var(--success)', label: '+ Nova matéria' } },
    existing: { bg: 'var(--surface)', border: 'var(--border)', badge: null },
    removed: { bg: '#2a0f0f', border: '#4a1a1a', badge: { bg: '#450a0a', color: '#f87171', label: '− Removida' } },
  }

  const cfg = statusConfig[subject.status]
  const newTopics = subject.topics.filter(t => t.status === 'new')
  const removedTopics = subject.topics.filter(t => t.status === 'removed')
  const changedCount = newTopics.length + removedTopics.length

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: cfg.bg, borderColor: cfg.border }}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-5 py-3 flex items-center gap-3 text-left"
      >
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: subject.color || 'var(--primary-strong)', opacity: subject.status === 'removed' ? 0.4 : 1 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: subject.status === 'removed' ? 'var(--text-muted)' : 'var(--text)', textDecoration: subject.status === 'removed' ? 'line-through' : 'none' }}>
              {subject.name}
            </span>
            {cfg.badge && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: cfg.badge.bg, color: cfg.badge.color }}>
                {cfg.badge.label}
              </span>
            )}
            {subject.status === 'existing' && changedCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#1e1a10', color: '#f59e0b' }}>
                {changedCount} alteração{changedCount !== 1 ? 'ões' : ''}
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: '#555568' }}>
            {subject.topics.length} tópico{subject.topics.length !== 1 ? 's' : ''}
            {newTopics.length > 0 && <span style={{ color: 'var(--success)' }}> · +{newTopics.length} novo{newTopics.length !== 1 ? 's' : ''}</span>}
            {removedTopics.length > 0 && <span style={{ color: '#f87171' }}> · -{removedTopics.length} removido{removedTopics.length !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <span className="text-xs flex-shrink-0" style={{ color: '#555568' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && subject.topics.length > 0 && (
        <div className="border-t divide-y" style={{ borderColor: cfg.border }}>
          {subject.topics.map((topic, i) => {
            const tColor = topic.status === 'new' ? 'var(--success)' : topic.status === 'removed' ? '#f87171' : 'var(--text-muted)'
            const tBg = topic.status === 'new' ? '#0a2010' : topic.status === 'removed' ? '#2a0808' : 'transparent'
            const prefix = topic.status === 'new' ? '+' : topic.status === 'removed' ? '−' : ' '
            return (
              <div key={i} className="flex items-center gap-3 px-5 py-2" style={{ background: tBg, borderColor: cfg.border }}>
                <span className="text-xs font-mono font-bold w-3 flex-shrink-0" style={{ color: tColor }}>{prefix}</span>
                <span
                  className="text-xs flex-1"
                  style={{
                    color: topic.status === 'existing' ? '#c0c0d0' : tColor,
                    textDecoration: topic.status === 'removed' ? 'line-through' : 'none',
                    opacity: topic.status === 'removed' ? 0.7 : 1,
                  }}
                >
                  {topic.name}
                </span>
                {topic.status === 'new' && (
                  <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: '#14532d', color: 'var(--success)' }}>novo</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
