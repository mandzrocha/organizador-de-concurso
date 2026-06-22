import { Exam, UF_NAMES } from './types'
import type { NewsItem } from '@/app/api/news/route'

// Palavras que indicam que a notícia é sobre abertura/publicação de edital.
const EDITAL_KEYWORDS = ['edital', 'inscriç', 'vagas', 'concurso aberto', 'autorizado', 'publicado', 'sai o', 'saiu o']

// Tokens curtos/genéricos que não servem para casar concurso com notícia.
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'para', 'com',
  'concurso', 'edital', 'publico', 'público', 'estado', 'municipal', 'federal',
  '2024', '2025', '2026', '2027',
])

// Palavras de "tipo de órgão" — comuns a vários concursos, então sozinhas
// geram falso positivo (ex.: "câmara" casa Câmara Municipal com Câmara dos
// Deputados). Para concursos NACIONAIS só contam junto de um token distintivo.
const WEAK_TOKENS = new Set([
  'camara', 'camaras', 'municipais', 'tribunal', 'tribunais', 'policia',
  'civil', 'militar', 'penal', 'ministerio', 'publica', 'secretaria',
  'instituto', 'banco', 'conselho', 'regional', 'superior', 'departamento',
  'defensoria', 'assembleia', 'legislativa', 'corpo', 'bombeiros',
  'prefeitura', 'justica', 'nacional', 'geral', 'escola', 'centro',
  'estadual', 'oficial', 'agente', 'analista', 'tecnico',
])

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acentos
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return norm(s).split(/\s+/).filter(t => t.length >= 3 && !STOPWORDS.has(t))
}

// Palavras geográficas (nomes de estados) — comuns demais para servir de
// token distintivo de um concurso nacional (ex.: "sao", "paulo", "rio"
// casariam "São Francisco", "Rio Branco"...).
const GEO_TOKENS = new Set<string>(['sao', 'santa', 'santo'])
for (const nm of Object.values(UF_NAMES)) for (const t of tokens(nm)) GEO_TOKENS.add(t)

// Tokens DISTINTIVOS de um concurso NACIONAL (tira genéricos e geográficos).
// Se sobrar vazio (nome só com palavras comuns, ex.: "Câmara Municipal" ou
// "Tribunal de Justiça de São Paulo"), não casa nada.
function strongExamTokens(exam: Exam): Set<string> {
  const all = [...tokens(exam.name), ...tokens(exam.organization || '')]
  return new Set(all.filter(t => !WEAK_TOKENS.has(t) && !GEO_TOKENS.has(t)))
}

/**
 * Decide se uma notícia é sobre um concurso.
 * - Concurso POR ESTADO (uf preenchido): exige bater o ESTADO (sigla como
 *   palavra inteira OU nome completo do estado) E um token de TIPO de órgão
 *   (assembleia, tribunal, policia, ale...). Assim "Rio Grande do Sul" não
 *   casa com notícia do "Rio Grande do Norte" nem "ALE-RS" com "ALE RR".
 * - Concurso NACIONAL: exige um token distintivo (INSS, Petrobras...).
 */
function newsMatchesExam(exam: Exam, item: NewsItem): boolean {
  // Só o TÍTULO: é o assunto real da notícia. A descrição costuma ser um
  // "resumão" que cita vários concursos e gera falso positivo (ex.: título
  // sobre PREVCOM casando com TJSP só porque a descrição cita TJSP).
  const hay = norm(item.title)
  const hayTokens = new Set(tokens(item.title))

  // Palavra-chave manual: se definida, manda nela (frase exata no título).
  // Várias separadas por vírgula = casa se QUALQUER uma aparecer.
  const kw = (exam.news_keyword || '').trim()
  if (kw) {
    return kw.split(',').map(k => norm(k)).filter(k => k.length >= 2).some(k => hay.includes(k))
  }

  if (exam.uf) {
    const uf = exam.uf.toLowerCase()
    const stateName = norm(UF_NAMES[exam.uf] || '')
    const ufAsWord = new RegExp(`\\b${uf}\\b`).test(hay)
    const stateMatch = ufAsWord || (stateName.length > 0 && hay.includes(stateName))
    if (!stateMatch) return false
    // Tipo de órgão = tokens do nome/órgão que NÃO são do nome do estado nem a sigla
    const stateTokens = new Set(tokens(UF_NAMES[exam.uf] || ''))
    const typeTokens = [...new Set([...tokens(exam.name), ...tokens(exam.organization || '')])]
      .filter(t => !stateTokens.has(t) && t !== uf)
    return typeTokens.some(t => hayTokens.has(t))
  }

  const et = strongExamTokens(exam)
  if (et.size === 0) return false
  return [...et].some(t => hayTokens.has(t))
}

/**
 * Todas as notícias que mencionam um concurso específico (mais recentes
 * primeiro). NÃO exige palavra-chave de edital.
 */
export function newsForExam(exam: Exam, news: NewsItem[], limit = 8): NewsItem[] {
  const out: NewsItem[] = []
  for (const item of news) {
    if (newsMatchesExam(exam, item)) out.push(item)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Para cada concurso, a notícia mais recente que parece ser sobre o EDITAL
 * dele (precisa bater o concurso E conter palavra-chave de edital).
 */
export function matchEditalNews(exams: Exam[], news: NewsItem[]): Record<string, NewsItem> {
  const result: Record<string, NewsItem> = {}
  for (const exam of exams) {
    for (const item of news) {
      const hay = (item.title + ' ' + item.description).toLowerCase()
      if (!EDITAL_KEYWORDS.some(k => hay.includes(k))) continue
      if (newsMatchesExam(exam, item)) { result[exam.id] = item; break } // news já vem por data desc
    }
  }
  return result
}
