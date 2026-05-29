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
  topics: (Topic & { completedActivities: ActivityType[]; percent: number; lastExerciseScore: number | null })[]
  percent: number
}

interface LogModal {
  topicId: string
  topicName: string
  subjectName: string
}

const ACTIVITIES: { type: ActivityType; icon: string; label: string; desc: string }[] = [
  { type: 'video',      icon: '🎬', label: 'Videoaula',  desc: 'Assistiu aula em vídeo' },
  { type: 'reading',    icon: '📖', label: 'Leitura',    desc: 'Leu apostila ou livro' },
  { type: 'exercises',  icon: '✏️', label: 'Exercícios', desc: 'Resolveu questões' },
  { type: 'review',     icon: '🔁', label: 'Revisão',    desc: 'Revisou o conteúdo' },
]

const EXERCISE_THRESHOLD = 85

function getExerciseQuality(pct: number): number {
  if (pct >= 95) return 5
  if (pct >= 85) return 4
  if (pct >= 70) return 3
  if (pct >= 50) return 2
  return 1
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
  const [logModal, setLogModal] = useState<LogModal | null>(null)

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
    const logs: StudyLog[] = logsRes.data || []

    const completedByTopic: Record<string, Set<string>> = {}
    const lastExerciseByTopic: Record<string, number | null> = {}

    for (const log of logs) {
      if (!completedByTopic[log.topic_id]) completedByTopic[log.topic_id] = new Set()
      completedByTopic[log.topic_id].add(log.activity_type)

      if (log.activity_type === 'exercises' && log.total_questions && log.correct_answers != null) {
        if (!(log.topic_id in lastExerciseByTopic)) {
          lastExerciseByTopic[log.topic_id] = Math.round((log.correct_answers / log.total_questions) * 100)
        }
      }
    }

    const withProgress: SubjectWithProgress[] = subjectList.map(subject => {
      const subTopics = topics.filter(t => t.subject_id === subject.id).map(topic => {
        const completed = [...(completedByTopic[topic.id] || [])] as ActivityType[]
        return {
          ...topic,
          completedActivities: completed,
          percent: getTopicCompletionPercent(completed),
          lastExerciseScore: lastExerciseByTopic[topic.id] ?? null,
        }
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
            <p className="text-sm mt-1" style={{ color: '#f97316' }}>Sem data definida — estudando com edital anterior como referência</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/exams/${id}/edit`} className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:border-indigo-500" style={{ borderColor: '#2a2a38', color: '#8888a0' }}>
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
          <button onClick={() => setShowAddSubject(true)} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: '#1e1e30', color: '#818cf8' }}>
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
              onOpenLog={(topicId, topicName) => setLogModal({ topicId, topicName, subjectName: subject.name })}
            />
          ))
        )}
      </div>

      {/* Log Modal */}
      {logModal && (
        <LogStudyModal
          topicId={logModal.topicId}
          topicName={logModal.topicName}
          subjectName={logModal.subjectName}
          onClose={() => setLogModal(null)}
          onSaved={() => { setLogModal(null); loadData() }}
        />
      )}
    </div>
  )
}

function LogStudyModal({
  topicId, topicName, subjectName, onClose, onSaved
}: {
  topicId: string
  topicName: string
  subjectName: string
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [activity, setActivity] = useState<ActivityType | null>(null)
  const [total, setTotal] = useState('')
  const [correct, setCorrect] = useState('')
  const [duration, setDuration] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const totalNum = parseInt(total) || 0
  const correctNum = parseInt(correct) || 0
  const wrongNum = totalNum > 0 ? totalNum - correctNum : 0
  const pct = totalNum > 0 && correctNum >= 0 ? Math.round((correctNum / totalNum) * 100) : null
  const needsRevision = pct !== null && pct < EXERCISE_THRESHOLD

  const canSave = activity !== null && (
    activity !== 'exercises' || (totalNum > 0 && correctNum >= 0 && correctNum <= totalNum)
  )

  async function save() {
    if (!canSave) return
    setSaving(true)

    await supabase.from('study_logs').insert({
      topic_id: topicId,
      activity_type: activity,
      notes: notes || null,
      duration_minutes: duration ? parseInt(duration) : null,
      total_questions: activity === 'exercises' && totalNum > 0 ? totalNum : null,
      correct_answers: activity === 'exercises' && totalNum > 0 ? correctNum : null,
      studied_at: new Date().toISOString().split('T')[0],
    })

    // Spaced repetition scheduling
    const { data: existing } = await supabase.from('revision_schedule').select('*').eq('topic_id', topicId).single()

    if (activity === 'exercises' && pct !== null) {
      const quality = getExerciseQuality(pct)
      const { sm2 } = await import('@/lib/sm2')
      const result = sm2(
        quality,
        existing?.repetitions ?? 0,
        existing?.ease_factor ?? 2.5,
        existing?.interval_days ?? 0,
      )
      if (existing) {
        await supabase.from('revision_schedule').update({ ...result, last_reviewed: new Date().toISOString().split('T')[0] }).eq('id', existing.id)
      } else {
        await supabase.from('revision_schedule').insert({ topic_id: topicId, ...result, last_reviewed: new Date().toISOString().split('T')[0] })
      }
    } else if (!existing) {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
      await supabase.from('revision_schedule').insert({
        topic_id: topicId,
        next_review: tomorrow.toISOString().split('T')[0],
        last_reviewed: new Date().toISOString().split('T')[0],
      })
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden" style={{ background: '#13131a', borderColor: '#2a2a38' }}>
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: '#1e1e28' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium mb-0.5" style={{ color: '#6366f1' }}>{subjectName}</p>
              <h2 className="text-base font-semibold leading-tight" style={{ color: '#e8e8f0' }}>{topicName}</h2>
            </div>
            <button onClick={onClose} className="text-lg leading-none mt-0.5" style={{ color: '#555568' }}>✕</button>
          </div>
          <p className="text-xs mt-2" style={{ color: '#555568' }}>O que você estudou agora?</p>
        </div>

        <div className="p-5 space-y-5">
          {/* Activity picker */}
          <div className="grid grid-cols-2 gap-2">
            {ACTIVITIES.map(a => (
              <button
                key={a.type}
                onClick={() => setActivity(a.type)}
                className="flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-all"
                style={{
                  background: activity === a.type ? '#1e1e30' : '#17171f',
                  borderColor: activity === a.type ? '#6366f1' : '#2a2a38',
                }}
              >
                <span className="text-xl">{a.icon}</span>
                <div>
                  <p className="text-sm font-medium" style={{ color: activity === a.type ? '#c7d2fe' : '#c8c8e0' }}>{a.label}</p>
                  <p className="text-xs" style={{ color: '#555568' }}>{a.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Exercise fields */}
          {activity === 'exercises' && (
            <div className="rounded-xl border p-4 space-y-4" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
              <p className="text-xs font-medium" style={{ color: '#8888a0' }}>Resultado das questões</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs block mb-1" style={{ color: '#8888a0' }}>Total</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Ex: 50"
                    value={total}
                    onChange={e => setTotal(e.target.value)}
                    className="w-full"
                    style={{ textAlign: 'center' }}
                  />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: '#22c55e' }}>✓ Acertos</label>
                  <input
                    type="number"
                    min="0"
                    max={total || undefined}
                    placeholder="Ex: 40"
                    value={correct}
                    onChange={e => setCorrect(e.target.value)}
                    className="w-full"
                    style={{ textAlign: 'center' }}
                  />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: '#f87171' }}>✗ Erros</label>
                  <div
                    className="w-full rounded-lg px-3 py-2 text-center text-sm font-medium"
                    style={{ background: '#1a1a24', color: wrongNum > 0 ? '#f87171' : '#555568', border: '1px solid #2a2a38' }}
                  >
                    {totalNum > 0 ? wrongNum : '—'}
                  </div>
                </div>
              </div>

              {/* Percentage result */}
              {pct !== null && totalNum > 0 && (
                <div
                  className="rounded-xl p-3 flex items-center justify-between"
                  style={{ background: needsRevision ? '#1a1010' : '#0f1a10', border: `1px solid ${needsRevision ? '#7f1d1d' : '#14532d'}` }}
                >
                  <div>
                    <p className="text-2xl font-bold" style={{ color: needsRevision ? '#f87171' : '#4ade80' }}>{pct}%</p>
                    <p className="text-xs mt-0.5" style={{ color: needsRevision ? '#f87171' : '#4ade80' }}>
                      {needsRevision ? `⚠️ Abaixo de ${EXERCISE_THRESHOLD}% — revisão agendada` : `✓ Aprovado! Acima de ${EXERCISE_THRESHOLD}%`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs" style={{ color: '#555568' }}>Meta</p>
                    <p className="text-sm font-semibold" style={{ color: '#8888a0' }}>{EXERCISE_THRESHOLD}%</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Duration + notes (for all activities) */}
          {activity && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div style={{ width: '130px', flexShrink: 0 }}>
                  <label className="text-xs block mb-1" style={{ color: '#8888a0' }}>Duração (min)</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Ex: 45"
                    value={duration}
                    onChange={e => setDuration(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="text-xs block mb-1" style={{ color: '#8888a0' }}>Observações (opcional)</label>
                  <input
                    type="text"
                    placeholder="Ex: revisar questões 12-18"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm border" style={{ borderColor: '#2a2a38', color: '#8888a0' }}>
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ background: '#6366f1', color: '#fff' }}
          >
            {saving ? 'Salvando...' : 'Salvar registro'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SubjectCard({
  subject, examId, expanded, onToggle, onRefresh, onOpenLog
}: {
  subject: SubjectWithProgress
  examId: string
  expanded: boolean
  onToggle: () => void
  onRefresh: () => void
  onOpenLog: (topicId: string, topicName: string) => void
}) {
  const supabase = createClient()
  const [showAddTopic, setShowAddTopic] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')

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
      <button onClick={onToggle} className="w-full px-5 py-4 flex items-center gap-4 text-left transition-colors hover:bg-white/5">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: subject.color }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{subject.name}</p>
          <p className="text-xs mt-0.5" style={{ color: '#8888a0' }}>{completedTopics}/{subject.topics.length} tópicos completos</p>
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
                <div key={topic.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm" style={{ color: '#e8e8f0' }}>{topic.name}</p>
                      {topic.lastExerciseScore !== null && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{
                            background: topic.lastExerciseScore < EXERCISE_THRESHOLD ? '#1a1010' : '#0f1a10',
                            color: topic.lastExerciseScore < EXERCISE_THRESHOLD ? '#f87171' : '#4ade80',
                          }}
                        >
                          ✏️ {topic.lastExerciseScore}%
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-1.5">
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
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs" style={{ color: '#8888a0' }}>{topic.percent}%</span>
                    <button
                      onClick={() => onOpenLog(topic.id, topic.name)}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors hover:bg-indigo-500"
                      style={{ background: '#1e1e30', color: '#818cf8' }}
                    >
                      + Registrar
                    </button>
                  </div>
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
              <button onClick={() => setShowAddTopic(true)} className="text-xs" style={{ color: '#6366f1' }}>
                + Adicionar tópico
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
