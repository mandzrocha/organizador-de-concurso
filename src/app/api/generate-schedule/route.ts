import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const maxDuration = 60

export interface SchedulePreferences {
  daysPerWeek: number[]          // 0=dom, 1=seg, ..., 6=sáb
  hoursPerDay: number            // média de horas/dia
  horizonDays: number            // por quantos dias gerar
  focus: 'primary' | 'all' | 'specific'
  specificExamIds?: string[]
  includeCompletedSubjects: boolean  // legado: true=apenas revisão, false=pular
  // O que fazer com matérias/tópicos já concluídos:
  // 'skip' = não incluir | 'review' = só revisão | 'restudy' = estudar do zero de novo
  completedSubjectsMode?: 'skip' | 'review' | 'restudy'
  prioritizeOverdueReviews: boolean
  startDate?: string             // YYYY-MM-DD; padrão = hoje
  // Padrões por atividade — quais dias da semana cada atividade pode acontecer
  activityDays?: {
    video?: number[]
    reading?: number[]
    exercises?: number[]
    review?: number[]
  }
  // Preferências adicionais em linguagem natural para a IA
  notes?: string
}

const DEFAULT_PREFS: SchedulePreferences = {
  daysPerWeek: [1, 2, 3, 4, 5],
  hoursPerDay: 3,
  horizonDays: 14,
  focus: 'primary',
  includeCompletedSubjects: true,
  prioritizeOverdueReviews: true,
}

const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const prefs: SchedulePreferences = { ...DEFAULT_PREFS, ...body }
    // Resolve completed-subjects behavior (new field wins; fall back to legacy boolean).
    const completedMode: 'skip' | 'review' | 'restudy' =
      prefs.completedSubjectsMode ?? (prefs.includeCompletedSubjects ? 'review' : 'skip')

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const [examsRes, esRes, topicsRes, existingRes, revisionsRes] = await Promise.all([
      supabase.from('exams').select('*').eq('is_watching', false).order('is_primary', { ascending: false }),
      supabase.from('exam_subjects').select('exam_id, subject_id, completed_at'),
      supabase.from('topics').select('*, subject:subjects(*), study_logs(activity_type)'),
      supabase.from('calendar_plans').select('planned_date, topic_id, activity_type').gte('planned_date', new Date().toISOString().split('T')[0]),
      supabase.from('revision_schedule').select('topic_id, next_review, repetitions').lte('next_review', new Date().toISOString().split('T')[0]),
    ])

    const exams = examsRes.data || []
    const examSubjects = esRes.data || []
    const topics = topicsRes.data || []
    const existing = existingRes.data || []
    const overdueReviews = revisionsRes.data || []

    if (topics.length === 0) {
      return NextResponse.json({ error: 'Nenhum tópico cadastrado ainda' }, { status: 400 })
    }

    // Filter exams by focus preference
    let targetExamIds: Set<string>
    if (prefs.focus === 'primary') {
      const primary = exams.find((e: any) => e.is_primary)
      targetExamIds = new Set(primary ? [primary.id] : exams.map((e: any) => e.id))
    } else if (prefs.focus === 'specific' && prefs.specificExamIds?.length) {
      targetExamIds = new Set(prefs.specificExamIds)
    } else {
      targetExamIds = new Set(exams.map((e: any) => e.id))
    }

    // Build map: subject_id -> { completed_at, exam_ids }
    const subjectInfo: Record<string, { completed: boolean; examIds: string[] }> = {}
    for (const es of examSubjects as any[]) {
      if (!targetExamIds.has(es.exam_id)) continue
      if (!subjectInfo[es.subject_id]) subjectInfo[es.subject_id] = { completed: false, examIds: [] }
      subjectInfo[es.subject_id].examIds.push(es.exam_id)
      if (es.completed_at) subjectInfo[es.subject_id].completed = true
    }

    // Categorize topics
    const allActivities = ['video', 'reading', 'exercises', 'review']
    const studyTopics: any[] = []  // need normal study
    const reviewOnlyTopics: any[] = []  // completed subject, only review

    for (const t of topics as any[]) {
      const info = subjectInfo[t.subject_id]
      if (!info) continue
      const topicIsComplete = !!t.completed_at
      const subjectIsComplete = info.completed
      const done = new Set((t.study_logs || []).map((l: any) => l.activity_type))
      const remaining = allActivities.filter(a => !done.has(a))

      if (subjectIsComplete || topicIsComplete) {
        if (completedMode === 'skip') continue
        if (completedMode === 'restudy') {
          // Estudar de novo do zero (ex.: edital reaberto) — todas as atividades.
          studyTopics.push({ id: t.id, name: t.name, subject: t.subject?.name, remaining: allActivities })
        } else {
          reviewOnlyTopics.push({ id: t.id, name: t.name, subject: t.subject?.name })
        }
      } else if (remaining.length > 0) {
        studyTopics.push({ id: t.id, name: t.name, subject: t.subject?.name, remaining })
      }
    }

    if (studyTopics.length === 0 && reviewOnlyTopics.length === 0 && overdueReviews.length === 0) {
      return NextResponse.json({ error: 'Tudo em dia! Não há tópicos para estudar ou revisar agora.' }, { status: 400 })
    }

    // Build date list respecting daysPerWeek
    const startDate = prefs.startDate ? new Date(prefs.startDate) : new Date()
    const dates: string[] = []
    for (let i = 0; i < prefs.horizonDays; i++) {
      const d = new Date(startDate); d.setDate(startDate.getDate() + i)
      if (prefs.daysPerWeek.includes(d.getDay())) {
        dates.push(d.toISOString().split('T')[0])
      }
    }

    // Estimate activities per day: ~30 min each
    const activitiesPerDay = Math.max(2, Math.round(prefs.hoursPerDay * 2))
    const maxTotal = Math.min(80, dates.length * activitiesPerDay)

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: 'gemini-flash-latest',
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    })

    const overdueIds = new Set(overdueReviews.map((r: any) => r.topic_id))
    const overdueStudyTopics = studyTopics.filter(t => overdueIds.has(t.id))
    const overdueReviewOnly = reviewOnlyTopics.filter(t => overdueIds.has(t.id))

    // Build per-activity day restrictions
    const activityDayLines: string[] = []
    if (prefs.activityDays) {
      for (const [activity, days] of Object.entries(prefs.activityDays)) {
        if (days && days.length > 0 && days.length < 7) {
          const dayNames = days.map(d => DAY_NAMES[d]).join(', ')
          activityDayLines.push(`  - ${activity}: APENAS em ${dayNames}`)
        }
      }
    }

    const prompt = `Você é um assistente de planejamento de estudos para concursos públicos brasileiros.

PREFERÊNCIAS DO USUÁRIO:
- Dias de estudo: ${prefs.hoursPerDay}h/dia em ${prefs.daysPerWeek.length}x/semana
- Período: próximos ${prefs.horizonDays} dias (${dates.length} dias úteis de estudo: ${dates.slice(0, 5).join(', ')}${dates.length > 5 ? '...' : ''})
- Atividades estimadas por dia: ~${activitiesPerDay}
- Total máximo de atividades: ${maxTotal}
- Foco: ${prefs.focus === 'primary' ? 'concurso principal' : prefs.focus === 'all' ? 'todos os concursos' : 'concursos selecionados'}
- Priorizar revisões em atraso: ${prefs.prioritizeOverdueReviews ? 'SIM' : 'não'}
- Matérias concluídas: ${completedMode === 'skip' ? 'pular' : completedMode === 'restudy' ? 'ESTUDAR DE NOVO do zero (todas as atividades)' : 'incluir apenas como REVISÃO'}
${activityDayLines.length > 0 ? `- Restrições POR ATIVIDADE (cada atividade só pode ser planejada nos dias listados):\n${activityDayLines.join('\n')}` : ''}
${prefs.notes ? `\nObservações adicionais do usuário:\n"${prefs.notes}"` : ''}

CONCURSOS:
${exams.filter((e: any) => targetExamIds.has(e.id)).map((e: any) => `- ${e.name}${e.is_primary ? ' (FOCO PRINCIPAL)' : ''}, prova: ${e.exam_date || 'sem data'}`).join('\n')}

${overdueStudyTopics.length > 0 || overdueReviewOnly.length > 0 ? `🚨 REVISÕES EM ATRASO (priorizar nos primeiros dias):
${[...overdueStudyTopics, ...overdueReviewOnly].slice(0, 15).map(t => `- ID: ${t.id} | ${t.subject} > ${t.name}`).join('\n')}
` : ''}

TÓPICOS PARA ESTUDO (precisam de novas atividades):
${studyTopics.slice(0, 30).map(t => `- ID: ${t.id} | ${t.subject} > ${t.name} | falta: ${t.remaining.join(', ')}`).join('\n')}

${reviewOnlyTopics.length > 0 ? `TÓPICOS APENAS DE REVISÃO (matérias concluídas):
${reviewOnlyTopics.slice(0, 15).map(t => `- ID: ${t.id} | ${t.subject} > ${t.name}`).join('\n')}
` : ''}

Já planejado: ${existing.length} atividades futuras.

Gere um cronograma distribuindo as atividades pelos dias úteis disponíveis (${dates.length} dias).
Diretrizes:
- Use apenas datas da lista de dias úteis
- Priorize matérias com mais atividades faltando
- Varie matérias dentro de um mesmo dia (não 5 atividades da mesma matéria seguidas)
- Para tópicos de matérias CONCLUÍDAS, use apenas activity_type: "review"
- Para tópicos em atraso, agende-os nos primeiros 3 dias
- Não repita topic_id + activity_type no mesmo dia
- Máximo ${maxTotal} planos no total

Retorne APENAS um JSON válido:
{
  "plans": [
    { "planned_date": "YYYY-MM-DD", "topic_id": "uuid", "activity_type": "video|reading|exercises|review", "order_index": 0 }
  ]
}`

    const result = await model.generateContent(prompt)
    const text = result.response.text()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Resposta inválida da IA')

    const parsed = JSON.parse(jsonMatch[0])

    // Validate and filter generated plans:
    // - topic must exist in our candidate set
    // - planned_date must be in allowed dates
    // - activity_type must be valid
    // - activity_type must match allowed days for that activity
    const allowedTopicIds = new Set<string>([
      ...studyTopics.map(t => t.id),
      ...reviewOnlyTopics.map(t => t.id),
    ])
    const reviewOnlyIds = new Set(reviewOnlyTopics.map(t => t.id))
    const allowedDates = new Set(dates)
    const validActivities: Record<string, true> = { video: true, reading: true, exercises: true, review: true }

    const filteredPlans = (parsed.plans || []).filter((p: any) => {
      if (!allowedTopicIds.has(p.topic_id)) return false
      if (!allowedDates.has(p.planned_date)) return false
      if (!validActivities[p.activity_type]) return false
      // review-only topics: only allow 'review'
      if (reviewOnlyIds.has(p.topic_id) && p.activity_type !== 'review') return false
      // per-activity day restrictions
      if (prefs.activityDays) {
        const allowed = (prefs.activityDays as any)[p.activity_type] as number[] | undefined
        if (allowed && allowed.length > 0 && allowed.length < 7) {
          const dayOfWeek = new Date(p.planned_date + 'T00:00').getDay()
          if (!allowed.includes(dayOfWeek)) return false
        }
      }
      return true
    })

    return NextResponse.json({ plans: filteredPlans, total: filteredPlans.length })
  } catch (e: any) {
    console.error('generate-schedule error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
