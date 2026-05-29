'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Exam, Subject, Topic, StudyLog, ACTIVITY_LABELS, ACTIVITY_ICONS, ActivityType } from '@/lib/types'
import { getTopicCompletionPercent } from '@/lib/progress'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface SubjectWithProgress extends Subject {
  topics: (Topic & { completedActivities: ActivityType[]; percent: number })[]
  percent: number
}

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [exam, setExam] = useState<Exam | null>(null)
  const [subjects, setSubjects] = useState<SubjectWithProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null)
  const [showAddSubject, setShowAddSubject] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    const [examRes, esRes] = await Promise.all([
      supabase.from('exams').select('*').eq('id', id).single(),
      supabase.from('exam_subjects').select('*, subject:subjects(*)').eq('exam_id', id),
    ])

    if (examRes.error) { router.push('/exams'); return }
    setExam(examRes.data)

    const subjectIds = (esRes.data || []).map(es => es.subject_id)
    const subjectList = (esRes.data || []).map(es => es.subject as Subject)

    const [topicsRes, logsRes] = await Promise.all([
      supabase.from('topics').select('*').in('subject_id', subjectIds.length ? subjectIds : ['x']).order('order_index'),
      supabase.from('study_logs').select('*').order('studied_at', { ascending: false }),
    ])

    const topics = topicsRes.data || []
    const logs = logsRes.data || []

    const completedByTopic: Record<string, Set<string>> = {}
    for (const log of logs) {
      if (!completedByTopic[log.topic_id]) completedByTopic[log.topic_id] = new Set()
      completedByTopic[log.topic_id].add(log.activity_type)
    }

    const withProgress: SubjectWithProgress[] = subjectList.map(subject => {
      const subTopics = topics.filter(t => t.subject_id === subject.id).map(topic => {
        const completed = [...(completedByTopic[topic.id] || [])] as ActivityType[]
        return { ...topic, completedActivities: completed, percent: getTopicCompletionPercent(completed) }
      })
      const percent = subTopics.length ? Math.round(subTopics.reduce((s, t) => s + t.percent, 0) / subTopics.length) : 0
      return { ...subject, topics: subTopics, percent }
    })

    setSubjects(withProgress)
    setLoading(false)
  }

  async function addSubject() {
    if (!newSubjectName.trim()) return
    setSaving(true)
    const { data: existing } = await supabase.from('subjects').select('id').eq('name', newSubjectName.trim()).single()
    let subjectId: string

    if (existing) {
      subjectId = existing.id
    } else {
      const { data: newSub } = await supabase.from('subjects').insert({ name: newSubjectName.trim() }).select().single()
      subjectId = newSub!.id
    }

    await supabase.from('exam_subjects').upsert({ exam_id: id, subject_id: subjectId })
    setNewSubjectName('')
    setShowAddSubject(false)
    setSaving(false)
    loadData()
  }

  async function deleteExam() {
    if (!confirm(`Excluir "${exam?.name}"? Esta ação não pode ser desfeita.`)) return
    await supabase.from('exams').delete().eq('id', id)
    router.push('/exams')
  }

  if (loading) return <div className="flex items-center justify-center h-full" style={{ color: '#8888a0' }}><p className="text-sm">Carregando...</p></div>
  if (!exam) return null

  const totalTopics = subjects.reduce((s, sub) => s + sub.topics.length, 0)
  const overallPercent = subjects.length ? Math.round(subjects.reduce((s, sub) => s + sub.percent, 0) / subjects.length) : 0

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/exams" className="text-xs mb-2 block" style={{ color: '#8888a0' }}>← Concursos</Link>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {exam.is_primary && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#1e1e30', color: '#818cf8' }}>★ Foco principal</span>
            )}
            {exam.organization && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#1e1e28', color: '#8888a0' }}>{exam.organization}</span>
            )}
            {!exam.exam_date && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#1e1808', color: '#f97316' }}>📂 Pré-edital</span>
            )}
          </div>
          <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>{exam.name}</h1>
          {exam.exam_date ? (
            <p className="text-sm mt-1" style={{ color: '#8888a0' }}>
              Prova: {format(parseISO(exam.exam_date), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          ) : (
            <p className="text-sm mt-1" style={{ color: '#f97316' }}>
              Sem data definida — estudando com edital anterior como referência
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/exams/${id}/edit`}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:border-indigo-500"
            style={{ borderColor: '#2a2a38', color: '#8888a0' }}
          >
            ✏️ Editar
          </Link>
          <button onClick={deleteExam} className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:border-red-500 hover:text-red-400" style={{ borderColor: '#2a2a38', color: '#555568' }}>
            Excluir
          </button>
        </div>
      </div>

      {/* Progress overview */}
      <div className="rounded-xl border p-5 grid grid-cols-3 gap-5" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
        <div>
          <p className="text-xs mb-1" style={{ color: '#8888a0' }}>Progresso geral</p>
          <p className="text-2xl font-bold" style={{ color: '#e8e8f0' }}>{overallPercent}%</p>
          <div className="h-1.5 rounded-full mt-2" style={{ background: '#2a2a38' }}>
            <div className="h-1.5 rounded-full" style={{ width: `${overallPercent}%`, background: 'linear-gradient(90deg, #6366f1, #818cf8)' }} />
          </div>
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: '#8888a0' }}>Matérias</p>
          <p className="text-2xl font-bold" style={{ color: '#e8e8f0' }}>{subjects.length}</p>
          <p className="text-xs mt-1" style={{ color: '#555568' }}>no edital</p>
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: '#8888a0' }}>Tópicos</p>
          <p className="text-2xl font-bold" style={{ color: '#e8e8f0' }}>{totalTopics}</p>
          <p className="text-xs mt-1" style={{ color: '#555568' }}>para estudar</p>
        </div>
      </div>

      {/* Subjects list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium" style={{ color: '#8888a0' }}>Matérias</h2>
          <button
            onClick={() => setShowAddSubject(true)}
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: '#1e1e30', color: '#818cf8' }}
          >
            + Adicionar matéria
          </button>
        </div>

        {showAddSubject && (
          <div className="rounded-xl border p-4 flex items-center gap-3" style={{ background: '#17171f', borderColor: '#6366f1' }}>
            <input
              type="text"
              placeholder="Nome da matéria"
              value={newSubjectName}
              onChange={e => setNewSubjectName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSubject()}
              autoFocus
              style={{ flex: 1 }}
            />
            <button onClick={addSubject} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: '#6366f1', color: '#fff' }}>
              {saving ? '...' : 'Adicionar'}
            </button>
            <button onClick={() => setShowAddSubject(false)} className="text-sm" style={{ color: '#555568' }}>✕</button>
          </div>
        )}

        {subjects.length === 0 ? (
          <div className="text-center py-12 rounded-xl border border-dashed" style={{ borderColor: '#2a2a38' }}>
            <p className="text-sm" style={{ color: '#555568' }}>Nenhuma matéria adicionada ainda.</p>
          </div>
        ) : (
          subjects.map(subject => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              examId={id}
              expanded={expandedSubject === subject.id}
              onToggle={() => setExpandedSubject(expandedSubject === subject.id ? null : subject.id)}
              onRefresh={loadData}
            />
          ))
        )}
      </div>
    </div>
  )
}

function SubjectCard({
  subject, examId, expanded, onToggle, onRefresh
}: {
  subject: SubjectWithProgress
  examId: string
  expanded: boolean
  onToggle: () => void
  onRefresh: () => void
}) {
  const supabase = createClient()
  const [showLog, setShowLog] = useState<string | null>(null)
  const [logActivity, setLogActivity] = useState<ActivityType>('video')
  const [logNotes, setLogNotes] = useState('')
  const [logDuration, setLogDuration] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAddTopic, setShowAddTopic] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')

  async function logStudy(topicId: string) {
    setSaving(true)
    await supabase.from('study_logs').insert({
      topic_id: topicId,
      activity_type: logActivity,
      notes: logNotes || null,
      duration_minutes: logDuration ? parseInt(logDuration) : null,
    })

    // Update spaced repetition
    const { data: existing } = await supabase.from('revision_schedule').select('*').eq('topic_id', topicId).single()
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)

    if (!existing) {
      await supabase.from('revision_schedule').insert({
        topic_id: topicId,
        next_review: tomorrow.toISOString().split('T')[0],
        last_reviewed: new Date().toISOString().split('T')[0],
      })
    }

    setShowLog(null)
    setLogNotes('')
    setLogDuration('')
    setSaving(false)
    onRefresh()
  }

  async function addTopic() {
    if (!newTopicName.trim()) return
    await supabase.from('topics').insert({
      subject_id: subject.id,
      name: newTopicName.trim(),
      order_index: subject.topics.length,
    })
    setNewTopicName('')
    setShowAddTopic(false)
    onRefresh()
  }

  const completedTopics = subject.topics.filter(t => t.percent === 100).length
  const activities: ActivityType[] = ['video', 'exercises', 'reading', 'review']

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center gap-4 text-left transition-colors hover:bg-white/5"
      >
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: subject.color }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{subject.name}</p>
          <p className="text-xs mt-0.5" style={{ color: '#8888a0' }}>
            {completedTopics}/{subject.topics.length} tópicos completos
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-24 h-1.5 rounded-full" style={{ background: '#2a2a38' }}>
            <div className="h-1.5 rounded-full" style={{ width: `${subject.percent}%`, background: subject.color }} />
          </div>
          <span className="text-xs w-8 text-right" style={{ color: '#8888a0' }}>{subject.percent}%</span>
          <span className="text-xs" style={{ color: '#555568' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t" style={{ borderColor: '#2a2a38' }}>
          {subject.topics.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: '#555568' }}>Nenhum tópico ainda.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: '#1e1e28' }}>
              {subject.topics.map(topic => (
                <div key={topic.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm" style={{ color: '#e8e8f0' }}>{topic.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {activities.map(act => (
                          <span
                            key={act}
                            title={ACTIVITY_LABELS[act]}
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              background: topic.completedActivities.includes(act) ? '#1e2a1e' : '#1e1e28',
                              color: topic.completedActivities.includes(act) ? '#4ade80' : '#555568',
                            }}
                          >
                            {ACTIVITY_ICONS[act]}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-xs" style={{ color: '#8888a0' }}>{topic.percent}%</div>
                      <button
                        onClick={() => setShowLog(showLog === topic.id ? null : topic.id)}
                        className="text-xs px-2.5 py-1 rounded-lg"
                        style={{ background: '#1e1e30', color: '#818cf8' }}
                      >
                        + Registrar
                      </button>
                    </div>
                  </div>

                  {showLog === topic.id && (
                    <div className="mt-3 p-3 rounded-lg space-y-3" style={{ background: '#1a1a24' }}>
                      <div className="flex gap-1 flex-wrap">
                        {activities.map(act => (
                          <button
                            key={act}
                            onClick={() => setLogActivity(act)}
                            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-all"
                            style={{
                              background: logActivity === act ? '#1e1e30' : 'transparent',
                              borderColor: logActivity === act ? '#6366f1' : '#2a2a38',
                              color: logActivity === act ? '#818cf8' : '#8888a0',
                            }}
                          >
                            {ACTIVITY_ICONS[act]} {ACTIVITY_LABELS[act]}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Duração (min)"
                          value={logDuration}
                          onChange={e => setLogDuration(e.target.value)}
                          style={{ width: '130px', flex: 'none' }}
                        />
                        <input
                          type="text"
                          placeholder="Observações (opcional)"
                          value={logNotes}
                          onChange={e => setLogNotes(e.target.value)}
                          style={{ flex: 1 }}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => logStudy(topic.id)}
                          disabled={saving}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium"
                          style={{ background: '#6366f1', color: '#fff' }}
                        >
                          {saving ? '...' : 'Salvar registro'}
                        </button>
                        <button onClick={() => setShowLog(null)} className="text-xs" style={{ color: '#555568' }}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t" style={{ borderColor: '#2a2a38' }}>
            {showAddTopic ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Nome do tópico"
                  value={newTopicName}
                  onChange={e => setNewTopicName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTopic()}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button onClick={addTopic} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: '#6366f1', color: '#fff' }}>
                  Adicionar
                </button>
                <button onClick={() => setShowAddTopic(false)} className="text-xs" style={{ color: '#555568' }}>✕</button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddTopic(true)}
                className="text-xs"
                style={{ color: '#6366f1' }}
              >
                + Adicionar tópico
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
