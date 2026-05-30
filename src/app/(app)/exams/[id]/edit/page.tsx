'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Exam, SUBJECT_COLORS } from '@/lib/types'
import { isSupabaseConfigured } from '@/lib/config'
import type { SubjectDiff, EditalDiff } from '@/app/api/compare-edital/route'

type TabKey = 'info' | 'edital'
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

interface ExtractedSubject {
  name: string
  topics: string[]
  isShared: boolean
  color: string
}

export default function EditExamPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [exam, setExam] = useState<Exam | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>(() => (searchParams.get('tab') === 'edital' ? 'edital' : 'info'))
  const [subjectCount, setSubjectCount] = useState<number>(0)

  // Info form
  const [form, setForm] = useState({ name: '', organization: '', exam_date: '', description: '', is_primary: false, pre_edital: false, is_watching: false })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Edital diff (studying mode)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [comparing, setComparing] = useState(false)
  const [diff, setDiff] = useState<EditalDiff | null>(null)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  // Initial extraction (watching mode)
  const [files, setFiles] = useState<File[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedSubject[]>([])
  const [extractError, setExtractError] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => { loadExam() }, [id])

  async function loadExam() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const [{ data }, { count }] = await Promise.all([
      supabase.from('exams').select('*').eq('id', id).single(),
      supabase.from('exam_subjects').select('*', { count: 'exact', head: true }).eq('exam_id', id),
    ])
    if (!data) { router.push('/exams'); return }
    setExam(data)
    setSubjectCount(count ?? 0)
    setForm({
      name: data.name,
      organization: data.organization || '',
      exam_date: data.exam_date || '',
      description: data.description || '',
      is_primary: data.is_primary,
      is_watching: data.is_watching || false,
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
      is_primary: form.is_watching ? false : form.is_primary,
      is_watching: form.is_watching,
      exam_date: form.is_watching || form.pre_edital ? null : (form.exam_date || null),
    }).eq('id', id)

    if (!form.is_watching && form.is_primary) {
      await supabase.from('exams').update({ is_primary: false }).neq('id', id)
      await supabase.from('exams').update({ is_primary: true }).eq('id', id)
    }

    setSaving(false)
    setSaveMsg('Salvo!')
    setTimeout(() => setSaveMsg(''), 2000)
    loadExam()
  }

  // ===== Studying flow (compare) =====
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
        if (sub.status === 'removed') continue

        let subjectId: string
        if (sub.status === 'new') {
          const { data: newSub } = await supabase
            .from('subjects')
            .insert({ name: sub.name, color: SUBJECT_COLORS[si % SUBJECT_COLORS.length] })
            .select().single()
          subjectId = newSub!.id
          await supabase.from('exam_subjects').upsert({ exam_id: id, subject_id: subjectId })
        } else {
          subjectId = sub.existingId!
        }

        const newTopics = sub.topics.filter(t => t.status === 'new')
        if (newTopics.length > 0) {
          const { data: existing } = await supabase
            .from('topics')
            .select('order_index')
            .eq('subject_id', subjectId)
            .eq('exam_id', id)
            .order('order_index', { ascending: false })
            .limit(1)
          const baseOrder = (existing?.[0]?.order_index ?? -1) + 1
          await supabase.from('topics').insert(newTopics.map((t, i) => ({
            subject_id: subjectId,
            exam_id: id,
            name: t.name,
            order_index: baseOrder + i,
          })))
        }
      }
      setApplied(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  // ===== Watching flow (initial extraction) =====
  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const newFiles = Array.from(incoming).filter(f =>
      f.type === 'application/pdf' || ACCEPTED_IMAGE_TYPES.includes(f.type)
    )
    const hasPdf = newFiles.some(f => f.type === 'application/pdf')
    if (hasPdf) {
      setFiles(newFiles.filter(f => f.type === 'application/pdf').slice(0, 1))
    } else {
      setFiles(prev => {
        const existingImages = prev.filter(f => f.type !== 'application/pdf')
        const combined = [...existingImages, ...newFiles]
        const seen = new Set<string>()
        return combined.filter(f => {
          const k = `${f.name}-${f.size}`
          if (seen.has(k)) return false
          seen.add(k); return true
        })
      })
    }
  }

  async function extractInitial() {
    if (!files.length) return
    setExtracting(true)
    setExtractError('')
    try {
      const formData = new FormData()
      for (const f of files) formData.append('files', f)
      const res = await fetch('/api/extract-edital', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha na extração')
      setExtracted(data.subjects.map((s: any, i: number) => ({
        ...s,
        isShared: true,
        color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
      })))
    } catch (e: any) {
      setExtractError(e.message)
    } finally {
      setExtracting(false)
    }
  }

  async function applyExtracted(promoteToStudying: boolean) {
    setImporting(true)
    setExtractError('')
    try {
      for (const sub of extracted) {
        let subjectId: string
        const { data: existing } = await supabase.from('subjects').select('id').eq('name', sub.name).maybeSingle()
        if (existing) {
          subjectId = existing.id
        } else {
          const { data: newSub } = await supabase.from('subjects').insert({ name: sub.name, color: sub.color }).select().single()
          subjectId = newSub!.id
        }
        // Always create topics scoped to THIS exam (don't reuse other exam's topics)
        const topicInserts = sub.topics.map((name, i) => ({
          subject_id: subjectId,
          exam_id: id,
          name,
          order_index: i,
        }))
        if (topicInserts.length > 0) await supabase.from('topics').insert(topicInserts)
        await supabase.from('exam_subjects').upsert({ exam_id: id, subject_id: subjectId })
      }

      if (promoteToStudying) {
        await supabase.from('exams').update({ is_watching: false }).eq('id', id)
        router.push(`/exams/${id}`)
      } else {
        // keep watching, just reset
        setExtracted([])
        setFiles([])
        loadExam()
      }
    } catch (e: any) {
      setExtractError(e.message)
    } finally {
      setImporting(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}><p className="text-sm">Carregando...</p></div>
  if (!exam) {
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
      <div>
        <Link href={`/exams/${id}`} className="text-xs block mb-2" style={{ color: 'var(--text-muted)' }}>← Voltar ao concurso</Link>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Editar concurso</h1>
          {form.is_watching && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
              👀 De olho
            </span>
          )}
        </div>
        <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{exam.name}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        {([['info', 'Informações'], ['edital', (form.is_watching || subjectCount === 0) ? 'Anexar edital' : 'Atualizar edital']] as const).map(([key, label]) => (
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
          {/* Watching/Studying toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, is_watching: false }))}
              className="px-3 py-3 rounded-xl border text-left transition-all"
              style={{
                background: !form.is_watching ? 'var(--primary-soft)' : 'var(--surface-hover)',
                borderColor: !form.is_watching ? 'var(--primary)' : 'var(--border)',
              }}
            >
              <p className="text-sm font-medium" style={{ color: !form.is_watching ? 'var(--primary-soft-text)' : 'var(--text)' }}>📚 Estudar</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Concurso ativo com cronograma</p>
            </button>
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, is_watching: true, is_primary: false }))}
              className="px-3 py-3 rounded-xl border text-left transition-all"
              style={{
                background: form.is_watching ? 'var(--warning-soft)' : 'var(--surface-hover)',
                borderColor: form.is_watching ? 'var(--warning)' : 'var(--border)',
              }}
            >
              <p className="text-sm font-medium" style={{ color: form.is_watching ? 'var(--warning)' : 'var(--text)' }}>👀 De olho</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aguardando edital sair</p>
            </button>
          </div>

          {/* Warning: studying mode without an edital attached */}
          {!form.is_watching && subjectCount === 0 && (
            <div className="rounded-xl border p-4 flex items-start gap-3" style={{ background: 'var(--warning-soft)', borderColor: 'var(--warning)' }}>
              <span className="text-xl flex-shrink-0">📂</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--warning)' }}>Nenhum edital anexado ainda</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Para estudar você precisa de matérias e tópicos cadastrados. Anexe o PDF ou fotos do edital — pode ser o anterior se o novo ainda não saiu.
                </p>
                <button
                  type="button"
                  onClick={() => setTab('edital')}
                  className="mt-2 text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: 'var(--warning)', color: '#fff' }}
                >
                  📎 Anexar edital agora →
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Nome do concurso *</label>
            <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Órgão / Banca</label>
            <input type="text" value={form.organization} onChange={e => setForm(p => ({ ...p, organization: e.target.value }))} placeholder="Ex: TJSP, TRF1, Vunesp..." />
          </div>

          {!form.is_watching && (
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
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--warning-soft)' }}>
                  <span className="text-sm">📂</span>
                  <p className="text-xs" style={{ color: 'var(--warning)' }}>Sem data definida. Adicione a data assim que o edital for publicado.</p>
                </div>
              ) : (
                <input type="date" value={form.exam_date} onChange={e => setForm(p => ({ ...p, exam_date: e.target.value }))} />
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Descrição (opcional)</label>
            <textarea rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Cargo, observações..." style={{ resize: 'none' }} />
          </div>

          {!form.is_watching && (
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
          )}

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

      {/* Tab: Anexar edital (watching) OR Atualizar edital (studying) */}
      {tab === 'edital' && (form.is_watching || subjectCount === 0) && (
        <WatchingEditalFlow
          files={files}
          extracted={extracted}
          extracting={extracting}
          importing={importing}
          error={extractError}
          fileRef={fileRef}
          onAddFiles={addFiles}
          onRemoveFile={(i) => setFiles(prev => prev.filter((_, idx) => idx !== i))}
          onExtract={extractInitial}
          onUpdateSubjects={setExtracted}
          onApply={applyExtracted}
          onReset={() => { setExtracted([]); setFiles([]); setExtractError('') }}
        />
      )}

      {tab === 'edital' && !form.is_watching && subjectCount > 0 && (
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
              className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors"
              style={{ borderColor: pdfFile ? 'var(--primary)' : 'var(--border)' }}
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

            {error && <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{error}</div>}

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

function WatchingEditalFlow({
  files, extracted, extracting, importing, error, fileRef,
  onAddFiles, onRemoveFile, onExtract, onUpdateSubjects, onApply, onReset,
}: {
  files: File[]
  extracted: ExtractedSubject[]
  extracting: boolean
  importing: boolean
  error: string
  fileRef: React.RefObject<HTMLInputElement | null>
  onAddFiles: (files: FileList | null) => void
  onRemoveFile: (index: number) => void
  onExtract: () => void
  onUpdateSubjects: (subs: ExtractedSubject[]) => void
  onApply: (promote: boolean) => void
  onReset: () => void
}) {
  const isPdf = files.length === 1 && files[0].type === 'application/pdf'
  const isImages = files.length > 0 && files.every(f => f.type !== 'application/pdf')

  if (extracted.length > 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border p-5" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>Matérias extraídas do edital</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Revise e edite. Você pode importar mantendo o concurso "de olho" ou já promover para "estudando".
          </p>
        </div>

        {extracted.map((sub, si) => (
          <div key={si} className="rounded-xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="px-5 py-3 flex items-center gap-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: sub.color }} />
              <input
                className="flex-1 text-sm font-medium bg-transparent border-none outline-none p-0"
                style={{ color: 'var(--text)' }}
                value={sub.name}
                onChange={e => onUpdateSubjects(extracted.map((s, i) => i === si ? { ...s, name: e.target.value } : s))}
              />
              <button
                onClick={() => onUpdateSubjects(extracted.filter((_, i) => i !== si))}
                className="text-sm transition-colors"
                style={{ color: 'var(--text-subtle)' }}
              >
                ✕
              </button>
            </div>
            <div className="p-3 space-y-1">
              {sub.topics.map((topic, ti) => (
                <div key={ti} className="flex items-center gap-2">
                  <span className="text-xs w-4 text-center flex-shrink-0" style={{ color: 'var(--text-subtle)' }}>{ti + 1}</span>
                  <input
                    className="flex-1 text-xs bg-transparent border-none outline-none p-1"
                    style={{ color: 'var(--text)' }}
                    value={topic}
                    onChange={e => onUpdateSubjects(extracted.map((s, i) => i === si ? { ...s, topics: s.topics.map((t, j) => j === ti ? e.target.value : t) } : s))}
                  />
                  <button
                    onClick={() => onUpdateSubjects(extracted.map((s, i) => i === si ? { ...s, topics: s.topics.filter((_, j) => j !== ti) } : s))}
                    className="text-xs flex-shrink-0"
                    style={{ color: 'var(--text-subtle)' }}
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {error && <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{error}</div>}

        <div className="rounded-xl border p-4 flex flex-wrap items-center gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-xs flex-1" style={{ color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text)' }}>{extracted.length} matérias</strong> e <strong style={{ color: 'var(--text)' }}>{extracted.reduce((s, x) => s + x.topics.length, 0)} tópicos</strong> serão importados.
          </p>
          <button onClick={onReset} className="px-3 py-2 rounded-lg text-xs border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            Cancelar
          </button>
          <button
            onClick={() => onApply(false)}
            disabled={importing}
            className="px-3 py-2 rounded-lg text-xs font-medium border"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            👀 Salvar mantendo "de olho"
          </button>
          <button
            onClick={() => onApply(true)}
            disabled={importing}
            className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{ background: 'var(--primary-strong)', color: '#fff' }}
          >
            {importing ? '⏳ Importando...' : '🚀 Promover para estudo ativo'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border p-5 space-y-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div>
        <h2 className="text-sm font-medium" style={{ color: 'var(--text)' }}>Anexar edital deste concurso</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Saiu o edital? Faça upload do PDF ou tire fotos das páginas com as matérias. A IA extrai automaticamente o conteúdo programático.
        </p>
      </div>

      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors"
        style={{ borderColor: files.length > 0 ? 'var(--primary)' : 'var(--border)' }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          className="hidden"
          onChange={e => onAddFiles(e.target.files)}
        />
        {files.length === 0 ? (
          <>
            <div className="text-3xl mb-2">⬆️</div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Clique para selecionar PDF ou fotos do edital</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>PDF ou múltiplas imagens (JPG, PNG, WebP, HEIC)</p>
          </>
        ) : (
          <div>
            <div className="text-2xl mb-1">{isPdf ? '📄' : '🖼️'}</div>
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {isPdf ? files[0].name : `${files.length} foto${files.length > 1 ? 's' : ''} selecionada${files.length > 1 ? 's' : ''}`}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(2)} MB · clique para adicionar mais
            </p>
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md" style={{ background: 'var(--surface-hover)' }}>
              <span>{f.type === 'application/pdf' ? '📄' : '🖼️'}</span>
              <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>{f.name}</span>
              <span style={{ color: 'var(--text-subtle)' }}>{(f.size / 1024).toFixed(0)} KB</span>
              <button onClick={() => onRemoveFile(i)} className="text-xs" style={{ color: 'var(--text-subtle)' }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{error}</div>}

      {files.length > 0 && (
        <button
          onClick={onExtract}
          disabled={extracting}
          className="w-full py-2.5 rounded-lg text-sm font-medium disabled:opacity-60"
          style={{ background: 'var(--primary-strong)', color: '#fff' }}
        >
          {extracting ? '⏳ Analisando edital...' : '✨ Extrair com IA'}
        </button>
      )}
    </div>
  )
}

function SummaryChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold" style={{ color: value > 0 ? color : 'var(--text-subtle)' }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
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
      <div className="rounded-xl border p-4 grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <SummaryChip label="Matérias novas" value={summary.newSubjects} color="var(--success)" />
        <SummaryChip label="Matérias removidas" value={summary.removedSubjects} color="var(--danger)" />
        <SummaryChip label="Tópicos novos" value={summary.newTopics} color="var(--success)" />
        <SummaryChip label="Tópicos removidos" value={summary.removedTopics} color="var(--danger)" />
      </div>

      {!hasChanges && (
        <div className="rounded-xl border p-6 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="text-3xl mb-2">✅</div>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Nenhuma mudança detectada!</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>O novo edital tem o mesmo conteúdo programático.</p>
        </div>
      )}

      {diff.subjects.map((sub, i) => (
        <SubjectDiffCard key={i} subject={sub} />
      ))}

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
        <div className="rounded-xl border p-4 flex items-center justify-between" style={{ background: 'var(--surface)', borderColor: 'var(--success)' }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🎉</span>
            <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>Alterações aplicadas com sucesso!</p>
          </div>
          <button onClick={onGoBack} className="px-4 py-2 rounded-lg text-xs font-medium" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
            Ver concurso atualizado →
          </button>
        </div>
      )}
    </div>
  )
}

function SubjectDiffCard({ subject }: { subject: SubjectDiff }) {
  const [expanded, setExpanded] = useState(subject.status === 'new' || subject.topics.some(t => t.status !== 'existing'))

  const statusConfig = {
    new:      { bg: 'var(--success-soft)', border: 'var(--success)', badge: { bg: 'var(--success)',  color: '#fff', label: '+ Nova matéria' } },
    existing: { bg: 'var(--surface)',      border: 'var(--border)',  badge: null },
    removed:  { bg: 'var(--danger-soft)',  border: 'var(--danger)',  badge: { bg: 'var(--danger)',   color: '#fff', label: '− Removida' } },
  }

  const cfg = statusConfig[subject.status]
  const newTopics = subject.topics.filter(t => t.status === 'new')
  const removedTopics = subject.topics.filter(t => t.status === 'removed')
  const changedCount = newTopics.length + removedTopics.length

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: cfg.bg, borderColor: cfg.border }}>
      <button onClick={() => setExpanded(e => !e)} className="w-full px-5 py-3 flex items-center gap-3 text-left">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: subject.color || 'var(--primary-strong)', opacity: subject.status === 'removed' ? 0.4 : 1 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-sm font-medium"
              style={{
                color: subject.status === 'removed' ? 'var(--text-muted)' : 'var(--text)',
                textDecorationLine: subject.status === 'removed' ? 'line-through' : 'none',
              }}
            >
              {subject.name}
            </span>
            {cfg.badge && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: cfg.badge.bg, color: cfg.badge.color }}>
                {cfg.badge.label}
              </span>
            )}
            {subject.status === 'existing' && changedCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                {changedCount} alteração{changedCount !== 1 ? 'ões' : ''}
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>
            {subject.topics.length} tópico{subject.topics.length !== 1 ? 's' : ''}
            {newTopics.length > 0 && <span style={{ color: 'var(--success)' }}> · +{newTopics.length} novo{newTopics.length !== 1 ? 's' : ''}</span>}
            {removedTopics.length > 0 && <span style={{ color: 'var(--danger)' }}> · -{removedTopics.length} removido{removedTopics.length !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-subtle)' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && subject.topics.length > 0 && (
        <div className="border-t divide-y" style={{ borderColor: cfg.border }}>
          {subject.topics.map((topic, i) => {
            const isNew = topic.status === 'new'
            const isRemoved = topic.status === 'removed'
            const tColor = isNew ? 'var(--success)' : isRemoved ? 'var(--danger)' : 'var(--text-muted)'
            const tBg = isNew ? 'var(--success-soft)' : isRemoved ? 'var(--danger-soft)' : 'transparent'
            const prefix = isNew ? '+' : isRemoved ? '−' : ' '
            return (
              <div key={i} className="flex items-center gap-3 px-5 py-2" style={{ background: tBg, borderColor: cfg.border }}>
                <span className="text-xs font-mono font-bold w-3 flex-shrink-0" style={{ color: tColor }}>{prefix}</span>
                <span
                  className="text-xs flex-1"
                  style={{
                    color: topic.status === 'existing' ? 'var(--text)' : tColor,
                    textDecorationLine: isRemoved ? 'line-through' : 'none',
                    opacity: isRemoved ? 0.7 : 1,
                  }}
                >
                  {topic.name}
                </span>
                {isNew && (
                  <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0 font-medium" style={{ background: 'var(--success)', color: '#fff' }}>novo</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
