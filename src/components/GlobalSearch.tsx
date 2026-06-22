'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { Search, X, FileText, BookMarked, Hash, Library, CornerDownLeft, Trophy } from 'lucide-react'

interface SearchItem {
  type: 'exam' | 'topic' | 'subject' | 'catalog' | 'simulado'
  id: string
  label: string
  sub?: string
  color?: string
  href: string
}

const TYPE_META: Record<SearchItem['type'], { icon: React.ReactNode; group: string }> = {
  exam:     { icon: <FileText size={15} />,   group: 'Meus concursos' },
  subject:  { icon: <BookMarked size={15} />, group: 'Matérias' },
  topic:    { icon: <Hash size={15} />,       group: 'Tópicos' },
  simulado: { icon: <Trophy size={15} />,     group: 'Simulados' },
  catalog:  { icon: <Library size={15} />,    group: 'Biblioteca' },
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const supabase = createClient()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SearchItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [active, setActive] = useState(0)
  const [mounted, setMounted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Carrega o índice na primeira abertura
  useEffect(() => {
    if (open && !loaded) loadIndex()
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    if (!open) { setQuery(''); setActive(0) }
  }, [open])

  async function loadIndex() {
    if (!isSupabaseConfigured()) { setLoaded(true); return }
    const userId = await getUserId(supabase)
    if (!userId) { setLoaded(true); return }

    const { data: enr } = await supabase.from('user_exams').select('exam:exams(*)').eq('user_id', userId)
    const myExams = (enr || []).map((r: any) => r.exam).filter(Boolean)
    const myIds = new Set(myExams.map((e: any) => e.id))
    const examIds = myExams.map((e: any) => e.id)

    const [topicsRes, catalogRes, mockRes] = await Promise.all([
      examIds.length
        ? supabase.from('topics').select('id, name, exam_id, subject:subjects(name, color)').in('exam_id', examIds)
        : Promise.resolve({ data: [] as any }),
      supabase.from('exams').select('id, name, organization'),
      supabase.from('mock_exams').select('id, title, taken_at').eq('user_id', userId).order('taken_at', { ascending: false }),
    ])

    const list: SearchItem[] = []
    for (const e of myExams) list.push({ type: 'exam', id: e.id, label: e.name, sub: e.organization || undefined, href: `/exams/${e.id}` })

    const seenSubjects = new Set<string>()
    for (const t of (topicsRes.data || []) as any[]) {
      const subjName = t.subject?.name
      if (subjName && !seenSubjects.has(subjName)) {
        seenSubjects.add(subjName)
        list.push({ type: 'subject', id: 'subj-' + subjName, label: subjName, color: t.subject?.color, href: `/exams/${t.exam_id}` })
      }
      list.push({ type: 'topic', id: t.id, label: t.name, sub: subjName, color: t.subject?.color, href: `/exams/${t.exam_id}` })
    }

    // Simulados (mock_exams pode não existir ainda; ignora erro)
    for (const m of (mockRes.data || []) as any[]) {
      list.push({ type: 'simulado', id: 'sim-' + m.id, label: m.title, sub: 'Simulado', href: '/simulados' })
    }

    // Concursos do catálogo em que o usuário NÃO está inscrito
    for (const e of (catalogRes.data || []) as any[]) {
      if (!myIds.has(e.id)) list.push({ type: 'catalog', id: 'cat-' + e.id, label: e.name, sub: e.organization || undefined, href: `/biblioteca/${e.id}` })
    }

    setItems(list)
    setLoaded(true)
  }

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return [] as SearchItem[]
    const scored = items.filter(i => i.label.toLowerCase().includes(q) || (i.sub || '').toLowerCase().includes(q))
    // ordena: começa com o termo primeiro, depois por tipo
    const order: Record<SearchItem['type'], number> = { exam: 0, subject: 1, topic: 2, simulado: 3, catalog: 4 }
    return scored
      .sort((a, b) => {
        const as = a.label.toLowerCase().startsWith(q) ? 0 : 1
        const bs = b.label.toLowerCase().startsWith(q) ? 0 : 1
        if (as !== bs) return as - bs
        return order[a.type] - order[b.type]
      })
      .slice(0, 30)
  }, [items, query])

  useEffect(() => { setActive(0) }, [query])

  function go(item: SearchItem) {
    router.push(item.href)
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]) }
    else if (e.key === 'Escape') onClose()
  }

  if (!open || !mounted) return null

  // Agrupa resultados por tipo preservando a ordem
  const groups: { group: string; items: SearchItem[] }[] = []
  for (const r of results) {
    const g = TYPE_META[r.type].group
    let bucket = groups.find(x => x.group === g)
    if (!bucket) { bucket = { group: g, items: [] }; groups.push(bucket) }
    bucket.items.push(r)
  }

  let flatIndex = -1

  return createPortal((
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[10vh]" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-center gap-3 px-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <Search size={18} style={{ color: 'var(--text-subtle)' }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar concurso, matéria ou tópico..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 py-3.5 text-sm"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)' }}
          />
          <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center" style={{ color: 'var(--text-subtle)' }}><X size={16} /></button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {!query ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-subtle)' }}>
              Digite para buscar nos seus concursos, matérias e tópicos.
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-subtle)' }}>
              Nada encontrado para “{query}”.
            </p>
          ) : (
            groups.map(g => (
              <div key={g.group}>
                <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-subtle)' }}>{g.group}</p>
                {g.items.map(item => {
                  flatIndex++
                  const idx = flatIndex
                  const isActive = idx === active
                  return (
                    <button
                      key={item.id}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(item)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                      style={{ background: isActive ? 'var(--surface-hover)' : 'transparent' }}
                    >
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--primary-soft)', color: item.color || 'var(--primary)' }}>
                        {item.color && (item.type === 'topic' || item.type === 'subject')
                          ? <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                          : TYPE_META[item.type].icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate" style={{ color: 'var(--text)' }}>{item.label}</span>
                        {item.sub && <span className="block text-xs truncate" style={{ color: 'var(--text-subtle)' }}>{item.sub}</span>}
                      </span>
                      {isActive && <CornerDownLeft size={13} style={{ color: 'var(--text-subtle)' }} className="flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  ), document.body)
}
