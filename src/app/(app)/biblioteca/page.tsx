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
import { Exam, EXAM_CATEGORIES, EXAM_CATEGORY_LABELS, UF_NAMES } from '@/lib/types'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Library, Search, BookOpen, Rocket, Check, Plus, CalendarClock, FolderOpen } from 'lucide-react'

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

  useEffect(() => { load() }, [])
  useDataChanged(() => { load() })

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
                  <CatalogCard key={exam.id} exam={exam} enrolling={enrolling === exam.id} onEnroll={() => enroll(exam)} />
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
                  <CatalogCard key={exam.id} exam={exam} enrolling={false} onEnroll={() => router.push(`/exams/${exam.id}`)} />
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
    </div>
  )
}

function CatalogCard({ exam, enrolling, onEnroll }: { exam: CatalogExam; enrolling: boolean; onEnroll: () => void }) {
  return (
    <div className="ef-card p-5 flex items-start gap-4">
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
          {exam.organization && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>{exam.organization}</span>
          )}
          {!exam.exam_date && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
              <FolderOpen size={11} /> Pré-edital
            </span>
          )}
        </div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{exam.name}</h3>
        <div className="flex items-center gap-x-4 gap-y-0.5 mt-1 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
          <span>{exam.subject_count} matérias</span>
          <span>{exam.topic_count} tópicos</span>
          {exam.exam_date && (
            <span className="inline-flex items-center gap-1"><CalendarClock size={11} /> {format(parseISO(exam.exam_date), "d MMM yyyy", { locale: ptBR })}</span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 self-center">
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
