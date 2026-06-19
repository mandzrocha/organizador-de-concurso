import { Exam } from './types'
import type { NewsItem } from '@/app/api/news/route'

// Palavras que indicam que a notícia é sobre abertura/publicação de edital.
const EDITAL_KEYWORDS = ['edital', 'inscriç', 'inscriç', 'vagas', 'concurso aberto', 'autorizado', 'publicado', 'sai o', 'saiu o']

// Tokens curtos/genéricos que não servem para casar concurso com notícia.
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'para', 'com',
  'concurso', 'edital', 'publico', 'público', 'estado', 'municipal', 'federal',
  '2024', '2025', '2026', '2027',
])

// Palavras de "tipo de órgão" — comuns a vários concursos, então sozinhas
// geram falso positivo (ex.: "câmara" casa Câmara Municipal com Câmara dos
// Deputados). Só contam como match se vierem junto de um token distintivo.
const WEAK_TOKENS = new Set([
  'camara', 'camaras', 'municipais', 'tribunal', 'tribunais', 'policia',
  'civil', 'militar', 'penal', 'ministerio', 'publica', 'secretaria',
  'instituto', 'banco', 'conselho', 'regional', 'superior', 'departamento',
  'defensoria', 'assembleia', 'legislativa', 'corpo', 'bombeiros',
  'prefeitura', 'justica', 'nacional', 'geral', 'escola', 'centro',
  'estadual', 'oficial', 'agente', 'analista', 'tecnico',
])

function tokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t))
}

// Tokens DISTINTIVOS do concurso (tira os genéricos). Se sobrar vazio
// (nome só com palavras comuns, ex.: "Câmara Municipal"), não casa com nada.
function strongExamTokens(exam: Exam): Set<string> {
  const all = [...tokens(exam.name), ...tokens(exam.organization || '')]
  return new Set(all.filter(t => !WEAK_TOKENS.has(t)))
}

/**
 * Para cada concurso, acha a notícia mais recente que parece ser sobre o
 * edital dele: precisa bater um token distintivo (nome/órgão) E conter uma
 * palavra-chave de edital. Retorna um mapa examId -> NewsItem.
 */
/**
 * Todas as notícias que mencionam um concurso específico (por token
 * distintivo do nome/órgão), ordenadas como vieram (mais recentes primeiro).
 * Diferente de matchEditalNews: aqui NÃO exige palavra-chave de edital.
 */
export function newsForExam(exam: Exam, news: NewsItem[], limit = 8): NewsItem[] {
  const examTokens = strongExamTokens(exam)
  if (examTokens.size === 0) return []
  const out: NewsItem[] = []
  for (const item of news) {
    const titleTokens = new Set(tokens(item.title + ' ' + item.description))
    if ([...examTokens].some(t => titleTokens.has(t))) out.push(item)
    if (out.length >= limit) break
  }
  return out
}

export function matchEditalNews(exams: Exam[], news: NewsItem[]): Record<string, NewsItem> {
  const result: Record<string, NewsItem> = {}
  for (const exam of exams) {
    const examTokens = strongExamTokens(exam)
    if (examTokens.size === 0) continue
    for (const item of news) {
      const hay = (item.title + ' ' + item.description).toLowerCase()
      const hasEditalWord = EDITAL_KEYWORDS.some(k => hay.includes(k))
      if (!hasEditalWord) continue
      const titleTokens = new Set(tokens(item.title + ' ' + item.description))
      const matches = [...examTokens].some(t => titleTokens.has(t))
      if (matches) { result[exam.id] = item; break } // news já vem ordenada por data desc
    }
  }
  return result
}
