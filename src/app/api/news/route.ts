import { NextResponse } from 'next/server'

export const revalidate = 1800 // 30 min cache

export interface NewsItem {
  title: string
  link: string
  description: string
  pubDate: string
  source: string
}

const SOURCES = [
  { name: 'Gran Cursos',         url: 'https://blog.grancursosonline.com.br/feed/' },
  { name: 'Direção Concursos',   url: 'https://www.direcaoconcursos.com.br/artigos/feed/' },
  { name: 'Estratégia Concursos', url: 'https://www.estrategiaconcursos.com.br/blog/feed/' },
]

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i')
  const m = block.match(re)
  return m ? m[1].trim() : ''
}

// Entidades nomeadas mais comuns em feeds (traço, aspas curvas, reticências…)
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', deg: '°', eacute: 'é',
}

function decodeEntities(s: string): string {
  return s
    // numéricas decimais (&#8211;) e hexadecimais (&#x2013;)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    // nomeadas
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchSource(name: string, url: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ConcurFlow/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    })
    if (!res.ok) return []
    const xml = await res.text()
    const items: NewsItem[] = []
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let match: RegExpExecArray | null
    while ((match = itemRe.exec(xml)) !== null) {
      const block = match[1]
      const rawDesc = extractTag(block, 'description')
      items.push({
        title: stripHtml(extractTag(block, 'title')),
        link: extractTag(block, 'link'),
        description: stripHtml(rawDesc).slice(0, 280),
        pubDate: extractTag(block, 'pubDate'),
        source: name,
      })
    }
    return items
  } catch {
    return []
  }
}

export async function GET() {
  try {
    const results = await Promise.all(SOURCES.map(s => fetchSource(s.name, s.url)))
    const all = results.flat().filter(i => i.title && i.link)

    // Sort by pubDate desc
    all.sort((a, b) => {
      const da = new Date(a.pubDate).getTime() || 0
      const db = new Date(b.pubDate).getTime() || 0
      return db - da
    })

    return NextResponse.json({
      items: all.slice(0, 40),
      sources: SOURCES.map(s => s.name),
      total: all.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Erro ao buscar notícias' }, { status: 500 })
  }
}
