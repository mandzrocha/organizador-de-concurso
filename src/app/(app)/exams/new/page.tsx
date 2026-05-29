'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SUBJECT_COLORS } from '@/lib/types'

interface ExtractedSubject {
  name: string
  topics: string[]
  isShared: boolean
  color: string
}

export default function NewExamPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'info' | 'edital' | 'review' | 'saving'>('info')
  const [examInfo, setExamInfo] = useState({ name: '', organization: '', exam_date: '', description: '', is_primary: false, pre_edital: false })
  const [files, setFiles] = useState<File[]>([])
  const [extracting, setExtracting] = useState(false)
  const [subjects, setSubjects] = useState<ExtractedSubject[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const newFiles = Array.from(incoming).filter(f =>
      f.type === 'application/pdf' || ACCEPTED_IMAGE_TYPES.includes(f.type)
    )
    // If a PDF is added, replace everything with just the PDF
    const hasPdf = newFiles.some(f => f.type === 'application/pdf')
    if (hasPdf) {
      setFiles(newFiles.filter(f => f.type === 'application/pdf').slice(0, 1))
    } else {
      setFiles(prev => {
        const existingImages = prev.filter(f => f.type !== 'application/pdf')
        const combined = [...existingImages, ...newFiles]
        // deduplicate by name+size
        const seen = new Set<string>()
        return combined.filter(f => {
          const key = `${f.name}-${f.size}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      })
    }
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const isPdf = files.length === 1 && files[0].type === 'application/pdf'
  const isImages = files.length > 0 && files.every(f => ACCEPTED_IMAGE_TYPES.includes(f.type))

  async function extractFromFiles() {
    if (!files.length) return
    setExtracting(true)
    setError('')

    try {
      const formData = new FormData()
      for (const f of files) formData.append('files', f)

      const res = await fetch('/api/extract-edital', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Falha na extração')

      setSubjects(data.subjects.map((s: any, i: number) => ({
        ...s,
        isShared: true,
        color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
      })))
      setStep('review')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setExtracting(false)
    }
  }

  function buildExamPayload() {
    return {
      name: examInfo.name,
      organization: examInfo.organization || null,
      description: examInfo.description || null,
      is_primary: examInfo.is_primary,
      exam_date: examInfo.pre_edital ? null : (examInfo.exam_date || null),
    }
  }

  async function saveExam() {
    setSaving(true)
    try {
      // Create exam
      const { data: exam, error: examErr } = await supabase
        .from('exams')
        .insert(buildExamPayload())
        .select()
        .single()
      if (examErr) throw examErr

      // If primary, unset others
      if (examInfo.is_primary) {
        await supabase.from('exams').update({ is_primary: false }).neq('id', exam.id)
        await supabase.from('exams').update({ is_primary: true }).eq('id', exam.id)
      }

      // Create or find subjects and link them
      for (const sub of subjects) {
        // Try to find existing shared subject
        let subjectId: string

        const { data: existing } = await supabase
          .from('subjects')
          .select('id')
          .eq('name', sub.name)
          .single()

        if (existing) {
          subjectId = existing.id
        } else {
          const { data: newSub, error: subErr } = await supabase
            .from('subjects')
            .insert({ name: sub.name, color: sub.color })
            .select()
            .single()
          if (subErr) throw subErr
          subjectId = newSub.id

          // Create topics for new subject
          const topicInserts = sub.topics.map((name, i) => ({
            subject_id: subjectId,
            exam_id: null, // shared topic
            name,
            order_index: i,
          }))
          if (topicInserts.length > 0) {
            await supabase.from('topics').insert(topicInserts)
          }
        }

        // Link subject to exam
        await supabase.from('exam_subjects').upsert({ exam_id: exam.id, subject_id: subjectId })
      }

      router.push(`/exams/${exam.id}`)
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  async function saveExamWithoutEdital() {
    setSaving(true)
    try {
      const { data: exam, error: examErr } = await supabase
        .from('exams')
        .insert(buildExamPayload())
        .select()
        .single()
      if (examErr) throw examErr

      if (examInfo.is_primary) {
        await supabase.from('exams').update({ is_primary: false }).neq('id', exam.id)
        await supabase.from('exams').update({ is_primary: true }).eq('id', exam.id)
      }

      router.push(`/exams/${exam.id}`)
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>Novo Concurso</h1>
        <div className="flex items-center gap-2 mt-3">
          {(['info', 'edital', 'review'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium"
                style={{
                  background: step === s ? '#6366f1' : ['info', 'edital', 'review'].indexOf(step) > i ? '#1e1e30' : '#1e1e28',
                  color: step === s ? '#fff' : '#8888a0',
                }}
              >
                {['info', 'edital', 'review'].indexOf(step) > i ? '✓' : i + 1}
              </div>
              <span className="text-xs" style={{ color: step === s ? '#818cf8' : '#555568' }}>
                {s === 'info' ? 'Informações' : s === 'edital' ? 'Edital' : 'Revisar'}
              </span>
              {i < 2 && <span style={{ color: '#2a2a38' }}>—</span>}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#2a1a1a', color: '#f87171' }}>
          {error}
        </div>
      )}

      {/* Step 1: Info */}
      {step === 'info' && (
        <div className="rounded-xl border p-6 space-y-4" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8888a0' }}>Nome do concurso *</label>
            <input
              type="text"
              placeholder="Ex: TJSP — Escrevente Técnico Judiciário"
              value={examInfo.name}
              onChange={e => setExamInfo(p => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8888a0' }}>Órgão / Banca</label>
            <input
              type="text"
              placeholder="Ex: TJSP, TRF1, Vunesp..."
              value={examInfo.organization}
              onChange={e => setExamInfo(p => ({ ...p, organization: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8888a0' }}>Data da prova</label>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <div
                onClick={() => setExamInfo(p => ({ ...p, pre_edital: !p.pre_edital, exam_date: !p.pre_edital ? '' : p.exam_date }))}
                className="w-8 h-4 rounded-full relative transition-colors flex-shrink-0"
                style={{ background: examInfo.pre_edital ? '#f97316' : '#2a2a38' }}
              >
                <div
                  className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                  style={{ left: examInfo.pre_edital ? '17px' : '2px' }}
                />
              </div>
              <span className="text-xs" style={{ color: examInfo.pre_edital ? '#f97316' : '#8888a0' }}>
                Ainda não tem edital publicado — estudando com edital anterior
              </span>
            </label>
            {examInfo.pre_edital ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#1e1808', border: '1px solid #3a2e10' }}>
                <span className="text-sm">📂</span>
                <p className="text-xs" style={{ color: '#c8a040' }}>
                  Sem data definida. Você pode adicionar a data assim que o edital for publicado.
                </p>
              </div>
            ) : (
              <input
                type="date"
                value={examInfo.exam_date}
                onChange={e => setExamInfo(p => ({ ...p, exam_date: e.target.value }))}
              />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8888a0' }}>Descrição (opcional)</label>
            <textarea
              rows={2}
              placeholder="Cargo, observações..."
              value={examInfo.description}
              onChange={e => setExamInfo(p => ({ ...p, description: e.target.value }))}
              style={{ resize: 'none' }}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => setExamInfo(p => ({ ...p, is_primary: !p.is_primary }))}
              className="w-9 h-5 rounded-full relative transition-colors"
              style={{ background: examInfo.is_primary ? '#6366f1' : '#2a2a38' }}
            >
              <div
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                style={{ left: examInfo.is_primary ? '18px' : '2px' }}
              />
            </div>
            <span className="text-sm" style={{ color: '#e8e8f0' }}>Definir como concurso foco principal</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              disabled={!examInfo.name.trim()}
              onClick={() => setStep('edital')}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{ background: '#6366f1', color: '#fff' }}
            >
              Próximo →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Upload Edital */}
      {step === 'edital' && (
        <div className="rounded-xl border p-6 space-y-5" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
          <div>
            <h2 className="text-sm font-medium mb-1" style={{ color: '#e8e8f0' }}>Edital — PDF ou Fotos</h2>
            <p className="text-xs" style={{ color: '#8888a0' }}>
              Envie o PDF do edital <strong style={{ color: '#c8c8e0' }}>ou tire fotos</strong> das páginas com as matérias. A IA extrai tudo automaticamente.
            </p>
          </div>

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
            className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors hover:border-indigo-500"
            style={{ borderColor: files.length ? '#6366f1' : '#2a2a38' }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
            <div className="text-3xl mb-2">⬆️</div>
            <p className="text-sm" style={{ color: '#c8c8e0' }}>
              Clique ou arraste arquivos aqui
            </p>
            <p className="text-xs mt-1" style={{ color: '#555568' }}>
              PDF (1 arquivo) · Fotos JPG/PNG/WebP (várias) · Máx 10MB por arquivo
            </p>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((f, i) => {
                const isImage = ACCEPTED_IMAGE_TYPES.includes(f.type)
                const url = isImage ? URL.createObjectURL(f) : null
                return (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg border" style={{ background: '#1a1a24', borderColor: '#2a2a38' }}>
                    {url ? (
                      <img src={url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0 text-xl" style={{ background: '#1e1e30' }}>📄</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: '#e8e8f0' }}>{f.name}</p>
                      <p className="text-xs" style={{ color: '#555568' }}>{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <button onClick={() => removeFile(i)} className="text-sm flex-shrink-0" style={{ color: '#555568' }}>✕</button>
                  </div>
                )
              })}
              {isImages && (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full py-2 rounded-lg text-xs border border-dashed"
                  style={{ borderColor: '#2a2a38', color: '#6366f1' }}
                >
                  + Adicionar mais fotos
                </button>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep('info')} className="px-4 py-2.5 rounded-lg text-sm border" style={{ borderColor: '#2a2a38', color: '#8888a0' }}>
              ← Voltar
            </button>
            {files.length > 0 && (
              <button
                onClick={extractFromFiles}
                disabled={extracting}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium disabled:opacity-60"
                style={{ background: '#6366f1', color: '#fff' }}
              >
                {extracting
                  ? `⏳ Analisando ${isPdf ? 'PDF' : `${files.length} foto${files.length > 1 ? 's' : ''}`}...`
                  : `✨ Extrair com IA`}
              </button>
            )}
            <button
              onClick={saveExamWithoutEdital}
              disabled={saving}
              className="px-4 py-2.5 rounded-lg text-sm border disabled:opacity-40"
              style={{ borderColor: '#2a2a38', color: '#8888a0' }}
            >
              Pular →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review extracted subjects */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="rounded-xl border p-5" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
            <h2 className="text-sm font-medium mb-1" style={{ color: '#e8e8f0' }}>Matérias extraídas do edital</h2>
            <p className="text-xs" style={{ color: '#8888a0' }}>
              Revise e edite as matérias e tópicos antes de salvar. Matérias marcadas como "compartilhadas" são reaproveitadas entre concursos.
            </p>
          </div>

          {subjects.map((sub, si) => (
            <div key={si} className="rounded-xl border overflow-hidden" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
              <div className="px-5 py-3 flex items-center gap-3 border-b" style={{ borderColor: '#2a2a38' }}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: sub.color }} />
                <input
                  className="flex-1 text-sm font-medium bg-transparent border-none outline-none p-0"
                  style={{ color: '#e8e8f0' }}
                  value={sub.name}
                  onChange={e => setSubjects(prev => prev.map((s, i) => i === si ? { ...s, name: e.target.value } : s))}
                />
                <label className="flex items-center gap-1.5 text-xs flex-shrink-0" style={{ color: '#8888a0' }}>
                  <input
                    type="checkbox"
                    checked={sub.isShared}
                    className="w-3 h-3"
                    onChange={e => setSubjects(prev => prev.map((s, i) => i === si ? { ...s, isShared: e.target.checked } : s))}
                  />
                  Compartilhar entre concursos
                </label>
                <button
                  onClick={() => setSubjects(prev => prev.filter((_, i) => i !== si))}
                  className="text-sm hover:text-red-400 transition-colors"
                  style={{ color: '#555568' }}
                >
                  ✕
                </button>
              </div>
              <div className="p-3 space-y-1">
                {sub.topics.map((topic, ti) => (
                  <div key={ti} className="flex items-center gap-2">
                    <span className="text-xs w-4 text-center flex-shrink-0" style={{ color: '#555568' }}>{ti + 1}</span>
                    <input
                      className="flex-1 text-xs bg-transparent border-none outline-none p-1 rounded"
                      style={{ color: '#c0c0d0' }}
                      value={topic}
                      onChange={e => setSubjects(prev => prev.map((s, i) => i === si
                        ? { ...s, topics: s.topics.map((t, j) => j === ti ? e.target.value : t) }
                        : s
                      ))}
                    />
                    <button
                      onClick={() => setSubjects(prev => prev.map((s, i) => i === si
                        ? { ...s, topics: s.topics.filter((_, j) => j !== ti) }
                        : s
                      ))}
                      className="text-xs hover:text-red-400 transition-colors flex-shrink-0"
                      style={{ color: '#555568' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setSubjects(prev => prev.map((s, i) => i === si
                    ? { ...s, topics: [...s.topics, 'Novo tópico'] }
                    : s
                  ))}
                  className="text-xs mt-1 px-2 py-1 rounded"
                  style={{ color: '#6366f1' }}
                >
                  + Adicionar tópico
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={() => setSubjects(prev => [...prev, { name: 'Nova matéria', topics: [], isShared: true, color: SUBJECT_COLORS[prev.length % SUBJECT_COLORS.length] }])}
            className="w-full py-2.5 rounded-xl text-sm border border-dashed transition-colors"
            style={{ borderColor: '#2a2a38', color: '#6366f1' }}
          >
            + Adicionar matéria
          </button>

          <div className="flex gap-3">
            <button onClick={() => setStep('edital')} className="px-4 py-2.5 rounded-lg text-sm border" style={{ borderColor: '#2a2a38', color: '#8888a0' }}>
              ← Voltar
            </button>
            <button
              onClick={saveExam}
              disabled={saving || subjects.length === 0}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{ background: '#6366f1', color: '#fff' }}
            >
              {saving ? 'Salvando...' : `Salvar concurso (${subjects.length} matérias)`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
