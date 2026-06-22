'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { enrollUser } from '@/lib/exam-actions'
import { useToast } from '@/components/Toast'
import { PageSkeleton } from '@/components/Skeleton'
import { useDataChanged, emitDataChanged } from '@/lib/events'
import { Dropdown } from '@/components/Dropdown'
import { EditalStatusBadge } from '@/components/EditalStatusBadge'
import { newsForExam } from '@/lib/edital-news'
import type { NewsItem } from '@/app/api/news/route'
import { Exam, EXAM_CATEGORY_LABELS, UF_NAMES, EDITAL_STATUS } from '@/lib/types'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, Rocket, Check, CalendarClock, ExternalLink, Pencil, Building2, ScrollText, Library } from 'lucide-react'

interface DetailExam extends Exam {
  subject_count: number
  topic_count: number
  enrolled: boolean
}

export default function ConcursoDetailPage() {
  const supabase = createClient()
  const router = useRouter()
  const toast = useToast()
  const { id } = useParams<{ id: string }>()

  const [exam, setExam] = useState<DetailExam | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<'sobre' | 'noticias'>('sobre')
  const [enrolling, setEnrolling] = useState(false)

  const [editing, setEditing] = useState(false)
  const [banca, setBanca] = useState('')
  const [status, setStatus] = useState('previsto')
  const [keyword, setKeyword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [id])
  useDataChanged(() => { load() })

  useEffect(() => {
    fetch('/api/news').then(r => r.json()).then(d => setNews(d.items || [])).catch(() => {})
  }, [])

  async function load() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const userId = await getUserId(supabase)
    if (!userId) { setLoading(false); return }

    const { data: ex } = await supabase.from('exams').select('*').eq('id', id).maybeSingle()
    if (!ex) { setNotFound(true); setLoading(false); return }

    const [esRes, topRes, enrRes] = await Promise.all([
      supabase.from('exam_subjects').select('id', { count: 'exact', head: true }).eq('exam_id', id),
      supabase.from('topics').select('id', { count: 'exact', head: true }).eq('exam_id', id),
      supabase.from('user_exams').select('exam_id').eq('user_id', userId).eq('exam_id', id).maybeSingle(),
    ])

    const full: DetailExam = {
      ...(ex as Exam),
      subject_count: esRes.count || 0,
      topic_count: topRes.count || 0,
      enrolled: !!enrRes.data,
    }
    setExam(full)
    setBanca(full.banca || '')
    setStatus(full.edital_status || 'previsto')
    setKeyword(full.news_keyword || '')
    setLoading(false)
  }

  const related = useMemo(() => exam ? newsForExam(exam, news) : [], [exam, news])

  async function enroll() {
    if (!exam) return
    setEnrolling(true)
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
      setEnrolling(false)
    }
  }

  async function saveInfo() {
    if (!exam) return
    setSaving(true)
    try {
      const patch = { banca: banca.trim() || null, edital_status: status, news_keyword: keyword.trim() || null }
      const { error } = await supabase.from('exams').update(patch).eq('id', exam.id)
      if (error) throw error
      setExam({ ...exam, ...patch })
      toast.success('Informações atualizadas!')
      setEditing(false)
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message || 'tente novamente'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSkeleton variant="default" />

  if (notFound || !exam) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/biblioteca" className="text-sm inline-flex items-center gap-1.5 mb-6" style={{ color: 'var(--primary-strong)' }}>
          <ArrowLeft size={15} /> Voltar à Biblioteca
        </Link>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--surface-hover)', color: 'var(--text-subtle)' }}>
            <Library size={30} strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>Concurso não encontrado</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Ele pode ter sido removido do catálogo.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <Link href="/biblioteca" className="text-sm inline-flex items-center gap-1.5" style={{ color: 'var(--primary-strong)' }}>
        <ArrowLeft size={15} /> Voltar à Biblioteca
      </Link>

      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {exam.category && EXAM_CATEGORY_LABELS[exam.category] && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>{EXAM_CATEGORY_LABELS[exam.category]}</span>
            )}
            {exam.uf && <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>{UF_NAMES[exam.uf] || exam.uf}</span>}
            <EditalStatusBadge status={exam.edital_status} />
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>{exam.name}</h1>
          {exam.organization && <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{exam.organization}</p>}
        </div>
        {exam.enrolled ? (
          <Link href={`/exams/${exam.id}`} className="px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5 flex-shrink-0" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
            <Check size={15} /> Abrir concurso
          </Link>
        ) : (
          <button onClick={enroll} disabled={enrolling} className="px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
            <Rocket size={15} /> {enrolling ? 'Inscrevendo...' : 'Estudar este'}
          </button>
        )}
      </div>

      {/* Abas */}
      <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {([['sobre', 'Sobre'], ['noticias', `Notícias${related.length ? ` (${related.length})` : ''}`]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className="text-sm px-4 py-2.5 border-b-2 -mb-px transition-colors"
            style={tab === k
              ? { borderColor: 'var(--primary)', color: 'var(--primary-strong)', fontWeight: 600 }
              : { borderColor: 'transparent', color: 'var(--text-muted)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sobre' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <InfoBox icon={<Building2 size={14} />} label="Órgão" value={exam.organization || '—'} />
            <InfoBox icon={<ScrollText size={14} />} label="Banca" value={exam.banca || 'A definir'} />
            <InfoBox icon={<CalendarClock size={14} />} label="Situação" value={statusLabel(exam.edital_status)} />
          </div>

          {exam.description && (
            <div className="ef-card p-5">
              <p className="text-xs uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-subtle)' }}>Cargos / Descrição</p>
              <p className="text-sm" style={{ color: 'var(--text)' }}>{exam.description}</p>
            </div>
          )}

          <div className="flex items-center gap-5 text-sm" style={{ color: 'var(--text-muted)' }}>
            <span><strong style={{ color: 'var(--text)' }}>{exam.subject_count}</strong> matérias</span>
            <span><strong style={{ color: 'var(--text)' }}>{exam.topic_count}</strong> tópicos</span>
            {exam.exam_date && <span className="inline-flex items-center gap-1"><CalendarClock size={13} /> Prova: {format(parseISO(exam.exam_date), "d 'de' MMM 'de' yyyy", { locale: ptBR })}</span>}
          </div>

          {/* Editar banca / situação */}
          {editing ? (
            <div className="ef-card p-5 space-y-3" style={{ borderColor: 'var(--primary)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Editar informações do edital</h3>
              <div>
                <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Banca organizadora</label>
                <input type="text" placeholder="Ex: Cebraspe, FGV, Vunesp..." value={banca} onChange={e => setBanca(e.target.value)} />
              </div>
              <div>
                <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Situação do edital</label>
                <Dropdown value={status} onChange={setStatus} options={EDITAL_STATUS.map(s => ({ value: s.key, label: s.label }))} />
              </div>
              <div>
                <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Palavra-chave para notícias</label>
                <input type="text" placeholder="Ex: TJSP, Tribunal de Justiça de São Paulo" value={keyword} onChange={e => setKeyword(e.target.value)} />
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-subtle)' }}>
                  Quando preenchida, só casa notícia que tenha exatamente isso no título (várias separadas por vírgula). Evita confundir com outro concurso.
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditing(false); setBanca(exam.banca || ''); setStatus(exam.edital_status || 'previsto'); setKeyword(exam.news_keyword || '') }} className="flex-1 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Cancelar</button>
                <button onClick={saveInfo} disabled={saving} className="flex-1 py-2 rounded-lg text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--primary-strong)', color: '#fff' }}>{saving ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="text-sm inline-flex items-center gap-1.5" style={{ color: 'var(--primary-strong)' }}>
              <Pencil size={13} /> Editar banca, situação e palavra-chave de notícias
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {related.length === 0 ? (
            <div className="ef-card p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Nenhuma notícia recente sobre este concurso.
            </div>
          ) : related.map((n, i) => {
            let d: Date | null = null
            try { d = new Date(n.pubDate) } catch {}
            const ok = d && !isNaN(d.getTime())
            return (
              <a key={i} href={n.link} target="_blank" rel="noopener noreferrer" className="ef-card p-4 flex items-start gap-2 transition-colors hover:bg-[var(--surface-hover)]">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{n.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>
                    {n.source}{ok ? ` · ${formatDistanceToNow(d!, { locale: ptBR, addSuffix: true })}` : ''}
                  </p>
                </div>
                <ExternalLink size={13} style={{ color: 'var(--text-subtle)' }} className="flex-shrink-0 mt-0.5" />
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

function statusLabel(status: string | null): string {
  const found = EDITAL_STATUS.find(s => s.key === status)
  return found ? found.label : 'Previsto'
}

function InfoBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="ef-card p-4">
      <p className="text-xs uppercase tracking-wide inline-flex items-center gap-1.5 mb-1" style={{ color: 'var(--text-subtle)' }}>{icon} {label}</p>
      <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }} title={value}>{value}</p>
    </div>
  )
}
