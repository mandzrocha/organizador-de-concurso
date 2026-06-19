'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { enrollUser } from '@/lib/exam-actions'
import { useToast } from '@/components/Toast'
import { PageSkeleton } from '@/components/Skeleton'
import { useDataChanged, emitDataChanged } from '@/lib/events'
import { Dropdown } from '@/components/Dropdown'
import { newsForExam } from '@/lib/edital-news'
import type { NewsItem } from '@/app/api/news/route'
import { Exam, EXAM_CATEGORIES, EXAM_CATEGORY_LABELS, UF_NAMES, EDITAL_STATUS, EDITAL_STATUS_MAP } from '@/lib/types'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Library, Search, BookOpen, Rocket, Check, Plus, CalendarClock, X, ExternalLink, Pencil, Building2, ScrollText } from 'lucide-react'

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  muted:   { bg: 'var(--surface-hover)', fg: 'var(--text-muted)' },
  warning: { bg: 'var(--warning-soft)',  fg: 'var(--warning)' },
  primary: { bg: 'var(--primary-soft)',  fg: 'var(--primary-soft-text)' },
  success: { bg: 'var(--success-soft)',  fg: 'var(--success)' },
  danger:  { bg: 'var(--danger-soft)',   fg: 'var(--danger)' },
}

function StatusBadge({ status }: { status: string | null }) {
  const meta = status ? EDITAL_STATUS_MAP[status] : null
  if (!meta) return null
  const tone = STATUS_TONE[meta.tone] || STATUS_TONE.muted
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: tone.bg, color: tone.fg }}>{meta.label}</span>
  )
}

interface CatalogExam extends Exam {
  subject_count: number
  topic_count: number
  enrolled: boolean
}

export default function BibliotecaPage() {
  const supabase = createClient()
  const router = useRouter()
  const toast = useToast()
  const [exams, setExams] = useState<CatalogExam[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [ufFilter, setUfFilter] = useState('all')
  const [enrolling, setEnrolling] = useState<string | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [detail, setDetail] = useState<CatalogExam | null>(null)

  useEffect(() => { load() }, [])
  useDataChanged(() => { load() })

  useEffect(() => {
    fetch('/api/news').then(r => r.json()).then(d => setNews(d.items || [])).catch(() => {})
  }, [])

  async function load() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const userId = await getUserId(supabase)
    if (!userId) { setLoading(false); return }

    const [examsRes, enrollRes, esRes, topicsRes] = await Promise.all([
      supabase.from('exams').select('*').order('created_at', { ascending: false }),
      supabase.from('user_exams').select('exam_id').eq('user_id', userId),
      supabase.from('exam_subjects').select('exam_id'),
      supabase.from('topics').select('exam_id'),
    ])

    const enrolledIds = new Set((enrollRes.data || []).map((r: any) => r.exam_id))
    const subjCount = new Map<string, number>()
    for (const r of (esRes.data || []) as any[]) subjCount.set(r.exam_id, (subjCount.get(r.exam_id) || 0) + 1)
    const topCount = new Map<string, number>()
    for (const r of (topicsRes.data || []) as any[]) if (r.exam_id) topCount.set(r.exam_id, (topCount.get(r.exam_id) || 0) + 1)

    setExams(((examsRes.data || []) as Exam[]).map(e => ({
      ...e,
      subject_count: subjCount.get(e.id) || 0,
      topic_count: topCount.get(e.id) || 0,
      enrolled: enrolledIds.has(e.id),
    })))
    setLoading(false)
  }

  async function enroll(exam: CatalogExam) {
    setEnrolling(exam.id)
    try {
      const userId = await getUserId(supabase)
      if (!userId) { toast.error('Sua sessão expirou. Faça login novamente.'); return }
      await enrollUser(supabase, exam.id, userId)
      toast.success(`Você começou a estudar "${exam.name}"`)
      emitDataChanged()
      router.push(`/exams/${exam.id}`)
    } catch (e: any) {
      toast.error('Erro ao inscrever: ' + (e?.message || 'tente novamente'))
    } finally {
      setEnrolling(null)
    }
  }

  // Opções de filtro que realmente existem nos dados
  const categoryOptions = useMemo(() => {
    const present = new Set(exams.map(e => e.category).filter(Boolean) as string[])
    return [{ value: 'all', label: 'Todas as áreas' }, ...EXAM_CATEGORIES.filter(c => present.has(c.key)).map(c => ({ value: c.key, label: c.label }))]
  }, [exams])

  const ufOptions = useMemo(() => {
    const present = [...new Set(exams.map(e => e.uf).filter(Boolean) as string[])].sort((a, b) => (UF_NAMES[a] || a).localeCompare(UF_NAMES[b] || b))
    return [
      { value: 'all', label: 'Todo o Brasil' },
      { value: 'nacional', label: 'Só nacionais' },
      ...present.map(uf => ({ value: uf, label: UF_NAMES[uf] || uf })),
    ]
  }, [exams])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return exams.filter(e => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false
      if (ufFilter === 'nacional' && e.uf) return false
      if (ufFilter !== 'all' && ufFilter !== 'nacional' && e.uf !== ufFilter) return false
      if (!q) return true
      return e.name.toLowerCase().includes(q) || (e.organization || '').toLowerCase().includes(q)
    })
  }, [exams, query, categoryFilter, ufFilter])

  const available = filtered.filter(e => !e.enrolled)
  const mine = filtered.filter(e => e.enrolled)

  if (loading) return <PageSkeleton variant="list" />

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Biblioteca de editais</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Concursos já cadastrados — comece a estudar sem subir o PDF de novo
          </p>
        </div>
        <a href="/exams/new" className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
          <Plus size={14} strokeWidth={2.5} /> Cadastrar novo edital
        </a>
      </div>

      {exams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            <Library size={30} strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>Biblioteca vazia</h2>
          <p className="text-sm mb-6 max-w-xs" style={{ color: 'var(--text-muted)' }}>
            Nenhum edital cadastrado ainda. Cadastre o primeiro com o PDF e ele fica disponível aqui.
          </p>
          <a href="/exams/new" className="px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
            <Plus size={14} strokeWidth={2.5} /> Cadastrar edital
          </a>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 z-10" style={{ color: 'var(--text-subtle)' }} />
              <input
                type="text"
                placeholder="Buscar por concurso ou órgão..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{ paddingLeft: 36 }}
              />
            </div>
            <div className="w-full sm:w-44">
              <Dropdown value={categoryFilter} onChange={setCategoryFilter} options={categoryOptions} />
            </div>
            <div className="w-full sm:w-44">
              <Dropdown value={ufFilter} onChange={setUfFilter} options={ufOptions} />
            </div>
          </div>

          {available.length > 0 && (
            <section>
              <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
                Disponíveis para estudar <span className="ml-1 text-xs">({available.length})</span>
              </h2>
              <div className="grid gap-3">
                {available.map(exam => (
                  <CatalogCard key={exam.id} exam={exam} enrolling={enrolling === exam.id} onEnroll={() => enroll(exam)} onOpen={() => setDetail(exam)} />
                ))}
              </div>
            </section>
          )}

          {mine.length > 0 && (
            <section>
              <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
                Você já estuda <span className="ml-1 text-xs">({mine.length})</span>
              </h2>
              <div className="grid gap-3">
                {mine.map(exam => (
                  <CatalogCard key={exam.id} exam={exam} enrolling={false} onEnroll={() => router.push(`/exams/${exam.id}`)} onOpen={() => setDetail(exam)} />
                ))}
              </div>
            </section>
          )}

          {available.length === 0 && mine.length === 0 && (
            <div className="ef-card p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Nenhum concurso encontrado para “{query}”.
            </div>
          )}
        </>
      )}

      {detail && (
        <DetailModal
          exam={detail}
          news={news}
          enrolling={enrolling === detail.id}
          onEnroll={() => enroll(detail)}
          onClose={() => setDetail(null)}
          onUpdated={(patch) => {
            setDetail(d => d ? { ...d, ...patch } : d)
            setExams(list => list.map(e => e.id === detail.id ? { ...e, ...patch } : e))
          }}
        />
      )}
    </div>
  )
}

function CatalogCard({ exam, enrolling, onEnroll, onOpen }: { exam: CatalogExam; enrolling: boolean; onEnroll: () => void; onOpen: () => void }) {
  return (
    <div className="ef-card p-5 flex items-start gap-4 ef-hover-lift cursor-pointer" onClick={onOpen} title="Ver detalhes">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
        <BookOpen size={20} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          {exam.category && EXAM_CATEGORY_LABELS[exam.category] && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>{EXAM_CATEGORY_LABELS[exam.category]}</span>
          )}
          {exam.uf && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>{exam.uf}</span>
          )}
          <StatusBadge status={exam.edital_status} />
        </div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{exam.name}</h3>
        <div className="flex items-center gap-x-4 gap-y-0.5 mt-1 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
          {exam.organization && <span className="truncate">{exam.organization}</span>}
          {exam.banca && <span>Banca: {exam.banca}</span>}
          <span>{exam.subject_count} matérias · {exam.topic_count} tópicos</span>
        </div>
      </div>
      <div className="flex-shrink-0 self-center" onClick={e => e.stopPropagation()}>
        {exam.enrolled ? (
          <button onClick={onEnroll} className="text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            <Check size={12} style={{ color: 'var(--success)' }} /> Estudando
          </button>
        ) : (
          <button onClick={onEnroll} disabled={enrolling} className="text-xs px-3 py-2 rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
            <Rocket size={12} /> {enrolling ? 'Inscrevendo...' : 'Estudar este'}
          </button>
        )}
      </div>
    </div>
  )
}

function DetailModal({ exam, news, enrolling, onEnroll, onClose, onUpdated }: {
  exam: CatalogExam
  news: NewsItem[]
  enrolling: boolean
  onEnroll: () => void
  onClose: () => void
  onUpdated: (patch: Partial<CatalogExam>) => void
}) {
  const supabase = createClient()
  const toast = useToast()
  const [tab, setTab] = useState<'sobre' | 'noticias'>('sobre')
  const [editing, setEditing] = useState(false)
  const [banca, setBanca] = useState(exam.banca || '')
  const [status, setStatus] = useState(exam.edital_status || 'previsto')
  const [saving, setSaving] = useState(false)

  const related = useMemo(() => newsForExam(exam, news), [exam, news])

  async function saveInfo() {
    setSaving(true)
    try {
      const patch = { banca: banca.trim() || null, edital_status: status }
      const { error } = await supabase.from('exams').update(patch).eq('id', exam.id)
      if (error) throw error
      onUpdated(patch as Partial<CatalogExam>)
      toast.success('Informações atualizadas!')
      setEditing(false)
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message || 'tente novamente'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl border flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', maxHeight: '88vh' }}>
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {exam.category && EXAM_CATEGORY_LABELS[exam.category] && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>{EXAM_CATEGORY_LABELS[exam.category]}</span>
                )}
                {exam.uf && <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>{UF_NAMES[exam.uf] || exam.uf}</span>}
                <StatusBadge status={exam.edital_status} />
              </div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>{exam.name}</h2>
            </div>
            <button onClick={onClose} style={{ color: 'var(--text-subtle)' }} className="flex-shrink-0"><X size={18} /></button>
          </div>
          {/* Tabs */}
          <div className="flex items-center gap-1 mt-3 -mb-3">
            {([['sobre', 'Sobre'], ['noticias', `Notícias${related.length ? ` (${related.length})` : ''}`]] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className="text-sm px-3 py-2 border-b-2 transition-colors"
                style={tab === k
                  ? { borderColor: 'var(--primary)', color: 'var(--primary-strong)', fontWeight: 600 }
                  : { borderColor: 'transparent', color: 'var(--text-muted)' }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto">
          {tab === 'sobre' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <InfoBox icon={<Building2 size={14} />} label="Órgão" value={exam.organization || '—'} />
                <InfoBox icon={<ScrollText size={14} />} label="Banca" value={exam.banca || 'A definir'} />
              </div>
              {exam.description && (
                <div>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-subtle)' }}>Cargos / Descrição</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>{exam.description}</p>
                </div>
              )}
              <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                <span>{exam.subject_count} matérias</span>
                <span>{exam.topic_count} tópicos</span>
                {exam.exam_date && <span className="inline-flex items-center gap-1"><CalendarClock size={13} /> {format(parseISO(exam.exam_date), "d MMM yyyy", { locale: ptBR })}</span>}
              </div>

              {/* Editar banca / situação */}
              {editing ? (
                <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--primary)' }}>
                  <div>
                    <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Banca organizadora</label>
                    <input type="text" placeholder="Ex: Cebraspe, FGV, Vunesp..." value={banca} onChange={e => setBanca(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Situação do edital</label>
                    <Dropdown value={status} onChange={setStatus} options={EDITAL_STATUS.map(s => ({ value: s.key, label: s.label }))} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Cancelar</button>
                    <button onClick={saveInfo} disabled={saving} className="flex-1 py-2 rounded-lg text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--primary-strong)', color: '#fff' }}>{saving ? 'Salvando...' : 'Salvar'}</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setEditing(true)} className="text-xs inline-flex items-center gap-1.5" style={{ color: 'var(--primary-strong)' }}>
                  <Pencil size={12} /> Editar banca e situação do edital
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {related.length === 0 ? (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nenhuma notícia recente sobre este concurso.
                </div>
              ) : related.map((n, i) => {
                let d: Date | null = null
                try { d = new Date(n.pubDate) } catch {}
                const ok = d && !isNaN(d.getTime())
                return (
                  <a key={i} href={n.link} target="_blank" rel="noopener noreferrer" className="block p-3 rounded-lg transition-colors hover:bg-[var(--surface-hover)]" style={{ background: 'var(--surface-hover)' }}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{n.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>
                          {n.source}{ok ? ` · ${formatDistanceToNow(d!, { locale: ptBR, addSuffix: true })}` : ''}
                        </p>
                      </div>
                      <ExternalLink size={13} style={{ color: 'var(--text-subtle)' }} className="flex-shrink-0 mt-0.5" />
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex gap-3" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Fechar</button>
          {exam.enrolled ? (
            <button onClick={onEnroll} className="flex-1 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
              <Check size={14} /> Abrir concurso
            </button>
          ) : (
            <button onClick={onEnroll} disabled={enrolling} className="flex-1 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
              <Rocket size={14} /> {enrolling ? 'Inscrevendo...' : 'Estudar este'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
      <p className="text-xs uppercase tracking-wide inline-flex items-center gap-1.5 mb-1" style={{ color: 'var(--text-subtle)' }}>{icon} {label}</p>
      <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }} title={value}>{value}</p>
    </div>
  )
}
