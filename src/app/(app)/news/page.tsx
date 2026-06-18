'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { RotateCw, Newspaper, Eye, ArrowRight, AlertCircle } from 'lucide-react'
import type { NewsItem } from '@/app/api/news/route'

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  useEffect(() => { loadNews() }, [])

  async function loadNews() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/news')
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Erro ao buscar notícias')
      } else {
        setItems(data.items || [])
      }
    } catch (e: any) {
      setError(e.message || 'Erro de rede')
    } finally {
      setLoading(false)
    }
  }

  const sources = useMemo(() => [...new Set(items.map(i => i.source))], [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i => {
      if (sourceFilter !== 'all' && i.source !== sourceFilter) return false
      if (!q) return true
      return i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    })
  }, [items, search, sourceFilter])

  function watchExam(title: string) {
    // Best-effort: use the news title as the proposed exam name
    const cleaned = title
      .replace(/^(Concurso|Edital|Inscrições|Concurso público:?)\s*/i, '')
      .replace(/\s*[—–-]\s*\d{4}.*$/, '')
      .trim()
    return `/exams/new?watching=1&name=${encodeURIComponent(cleaned)}`
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Notícias de concursos</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Editais sendo publicados · atualizado a cada 30min
          </p>
        </div>
        <button
          onClick={loadNews}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          <RotateCw size={12} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar por palavra-chave (ex: TJSP, Polícia, BB)..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '200px' }}
        />
        {sources.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSourceFilter('all')}
              className="text-xs px-2.5 py-1.5 rounded-md border"
              style={{
                background: sourceFilter === 'all' ? 'var(--primary-soft)' : 'transparent',
                borderColor: sourceFilter === 'all' ? 'var(--primary)' : 'var(--border)',
                color: sourceFilter === 'all' ? 'var(--primary-soft-text)' : 'var(--text-muted)',
              }}
            >
              Todas fontes
            </button>
            {sources.map(s => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className="text-xs px-2.5 py-1.5 rounded-md border"
                style={{
                  background: sourceFilter === s ? 'var(--primary-soft)' : 'transparent',
                  borderColor: sourceFilter === s ? 'var(--primary)' : 'var(--border)',
                  color: sourceFilter === s ? 'var(--primary-soft-text)' : 'var(--text-muted)',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border p-4" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--danger)' }}>Não foi possível carregar as notícias</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{error}</p>
          <p className="text-xs mt-2" style={{ color: 'var(--text-subtle)' }}>
            As fontes (PCI Concursos / JC Concursos) podem estar fora do ar ou bloqueando requisições. Tente novamente em alguns minutos.
          </p>
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-xl border p-5 animate-pulse" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="h-4 rounded mb-3" style={{ background: 'var(--surface-hover)', width: '70%' }} />
              <div className="h-3 rounded mb-2" style={{ background: 'var(--surface-hover)' }} />
              <div className="h-3 rounded" style={{ background: 'var(--surface-hover)', width: '60%' }} />
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <div className="ef-card p-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            <Newspaper size={26} strokeWidth={1.5} />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>
            {search ? 'Nenhuma notícia encontrada com esse termo.' : 'Nenhuma notícia disponível agora.'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((item, i) => {
          let date: Date | null = null
          try { date = new Date(item.pubDate) } catch {}
          const isValidDate = date && !isNaN(date.getTime())
          return (
            <article key={i} className="ef-card p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
                    {item.source}
                  </span>
                  {isValidDate && (
                    <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                      {formatDistanceToNow(date!, { locale: ptBR, addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>

              <h2 className="text-base font-semibold mb-1.5" style={{ color: 'var(--text)' }}>
                {item.title}
              </h2>

              {item.description && (
                <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
                  {item.description}{item.description.length >= 280 ? '…' : ''}
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5"
                  style={{ background: 'var(--primary-strong)', color: '#fff' }}
                >
                  Ler completa <ArrowRight size={12} />
                </a>
                <Link
                  href={watchExam(item.title)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5"
                  style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
                  title="Adicionar este concurso à sua lista de acompanhamento"
                >
                  <Eye size={12} /> Ficar de olho
                </Link>
              </div>
            </article>
          )
        })}
      </div>

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-center pt-2" style={{ color: 'var(--text-subtle)' }}>
          Mostrando {filtered.length} de {items.length} notícias · fontes: {sources.join(', ')}
        </p>
      )}
    </div>
  )
}
