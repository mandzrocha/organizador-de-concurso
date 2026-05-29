import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { addDays } from 'date-fns'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Fetch all exams, subjects, topics and existing plans
    const [examsRes, topicsRes, existingRes] = await Promise.all([
      supabase.from('exams').select('*, exam_subjects(subject_id)').order('is_primary', { ascending: false }),
      supabase.from('topics').select('*, subject:subjects(*), study_logs(activity_type)'),
      supabase.from('calendar_plans').select('planned_date, topic_id, activity_type').gte('planned_date', new Date().toISOString().split('T')[0]),
    ])

    const exams = examsRes.data || []
    const topics = topicsRes.data || []
    const existing = existingRes.data || []

    if (topics.length === 0) {
      return NextResponse.json({ error: 'Nenhum tópico cadastrado ainda' }, { status: 400 })
    }

    // Find topics that still need study activities
    const needsStudy = topics.filter((t: any) => {
      const done = new Set((t.study_logs || []).map((l: any) => l.activity_type))
      return done.size < 4 // not all 4 activities done
    })

    if (needsStudy.length === 0) {
      return NextResponse.json({ error: 'Todos os tópicos já foram completamente estudados!' }, { status: 400 })
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash',
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    })

    const prompt = `Você é um assistente de planejamento de estudos para concursos públicos.

Concursos cadastrados:
${exams.map((e: any) => `- ${e.name}${e.is_primary ? ' (FOCO PRINCIPAL)' : ''}, data da prova: ${e.exam_date || 'indefinida'}`).join('\n')}

Tópicos que precisam de estudo (máx 20 mostrados):
${needsStudy.slice(0, 20).map((t: any) => `- ID: ${t.id} | ${t.subject?.name} > ${t.name}`).join('\n')}

Já planejado para os próximos dias: ${existing.length} atividades.

Gere um cronograma de estudos para os próximos 7 dias a partir de hoje (${new Date().toISOString().split('T')[0]}).
Distribua de forma inteligente: 3-5 atividades por dia, priorizando o concurso foco, variando matérias.

Retorne APENAS um JSON válido:
{
  "plans": [
    {
      "planned_date": "YYYY-MM-DD",
      "topic_id": "uuid do tópico",
      "activity_type": "video|exercises|reading|review",
      "order_index": 0
    }
  ]
}

Regras:
- Use apenas IDs de tópicos da lista fornecida
- activity_type deve ser um dos 4 valores válidos
- Máximo 30 planos no total
- Não repita o mesmo tópico + atividade no mesmo dia`

    const result = await model.generateContent(prompt)
    const text = result.response.text()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Resposta inválida da IA')

    const parsed = JSON.parse(jsonMatch[0])
    return NextResponse.json(parsed)
  } catch (e: any) {
    console.error('generate-schedule error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
