import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { extractTextFromPdf } from '@/lib/pdf'

export const maxDuration = 60

export interface TopicDiff {
  name: string
  status: 'new' | 'existing' | 'removed'
  existingId?: string
}

export interface SubjectDiff {
  name: string
  status: 'new' | 'existing' | 'removed'
  existingId?: string
  color?: string
  topics: TopicDiff[]
}

export interface EditalDiff {
  subjects: SubjectDiff[]
  summary: {
    newSubjects: number
    removedSubjects: number
    newTopics: number
    removedTopics: number
    unchangedTopics: number
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const examId = formData.get('examId') as string | null

    if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
    if (!examId) return NextResponse.json({ error: 'examId não informado' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Arquivo muito grande (máx 10MB)' }, { status: 400 })

    // Extract text from PDF
    const pdfText = await extractTextFromPdf(file)
    if (!pdfText || pdfText.length < 100) {
      return NextResponse.json({ error: 'Não foi possível extrair texto do PDF. O arquivo pode ser uma imagem escaneada sem texto.' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Fetch existing subjects and topics for this exam
    const { data: examSubjects } = await supabase
      .from('exam_subjects')
      .select('subject:subjects(id, name, color)')
      .eq('exam_id', examId)

    const existingSubjects = (examSubjects || []).map((es: any) => es.subject)
    const subjectIds = existingSubjects.map((s: any) => s.id)

    const { data: existingTopicsRaw } = await supabase
      .from('topics')
      .select('id, name, subject_id')
      .in('subject_id', subjectIds.length ? subjectIds : ['x'])

    const existingTopics = existingTopicsRaw || []

    const existingData = existingSubjects.map((s: any) => ({
      id: s.id,
      name: s.name,
      topics: existingTopics
        .filter((t: any) => t.subject_id === s.id)
        .map((t: any) => ({ id: t.id, name: t.name })),
    }))

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: 'gemini-flash-latest',
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 32768,
        responseMimeType: 'application/json',
      },
    })

    const result = await model.generateContent(`Compare o conteúdo programático de um novo edital com o edital anterior já cadastrado. O texto do novo edital foi extraído de um PDF e pode conter muito conteúdo irrelevante (Diário Oficial, despachos, regras de inscrição). Localize a seção de CONTEÚDO PROGRAMÁTICO / PROGRAMA DAS PROVAS (geralmente perto do fim, podendo estar dividida em BLOCOS — trate cada disciplina interna como matéria separada).

EDITAL ANTERIOR (matérias e tópicos já cadastrados no sistema):
${JSON.stringify(existingData, null, 2)}

CONTEÚDO DO NOVO EDITAL (texto completo extraído do PDF):
${pdfText.slice(0, 400000)}

---

Faça uma comparação detalhada entre o que estava no edital anterior e o que está no novo edital.

Para cada matéria, determine o status:
- "new": matéria que aparece APENAS no novo edital
- "existing": matéria que está nos dois editais (mesmo que o nome seja ligeiramente diferente — use julgamento semântico)
- "removed": matéria que estava no anterior mas NÃO aparece no novo

Para cada tópico, determine o status:
- "new": tópico novo que NÃO existia antes
- "existing": tópico que continua (mesmo que levemente reformulado)
- "removed": tópico que existia antes mas foi removido

Quando o status for "existing" ou "removed", inclua o campo "existingId" com o ID correspondente do edital anterior.

Retorne APENAS um JSON puro válido, sem markdown:
{
  "subjects": [
    {
      "name": "nome da matéria",
      "status": "new|existing|removed",
      "existingId": "id se existing ou removed",
      "topics": [
        { "name": "nome do tópico", "status": "new|existing|removed", "existingId": "id se existing ou removed" }
      ]
    }
  ]
}

Importante:
- Inclua TODAS as matérias: novas, existentes E removidas
- Inclua TODOS os tópicos de cada matéria
- Para matérias/tópicos removidos, use o nome e ID do edital anterior
- Seja preciso na comparação semântica`)

    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('AI response:', text)
      throw new Error('A IA não retornou um JSON válido. Tente novamente.')
    }

    const parsed: EditalDiff = JSON.parse(jsonMatch[0])

    // Attach colors from existing subjects
    const subjectById: Record<string, any> = Object.fromEntries(existingSubjects.map((s: any) => [s.id, s]))
    for (const sub of parsed.subjects) {
      if (sub.existingId && subjectById[sub.existingId]) {
        sub.color = subjectById[sub.existingId].color
      }
    }

    const allTopics = parsed.subjects.flatMap(s => s.topics)
    const summary = {
      newSubjects: parsed.subjects.filter(s => s.status === 'new').length,
      removedSubjects: parsed.subjects.filter(s => s.status === 'removed').length,
      newTopics: allTopics.filter(t => t.status === 'new').length,
      removedTopics: allTopics.filter(t => t.status === 'removed').length,
      unchangedTopics: allTopics.filter(t => t.status === 'existing').length,
    }

    return NextResponse.json({ subjects: parsed.subjects, summary })
  } catch (e: any) {
    console.error('compare-edital error:', e)
    return NextResponse.json({ error: e.message || 'Erro ao comparar edital' }, { status: 500 })
  }
}
