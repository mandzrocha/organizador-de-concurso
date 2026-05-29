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

  if (loading) return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}><p className="text-sm">Carregando...</p></div>
  if (!exam) return null

  const totalTopics = subjects.reduce((s, sub) => s + sub.topics.length, 0)
  const overallPercent = subjects.length ? Math.round(subjects.reduce((s, sub) => s + sub.percent, 0) / subjects.length) : 0

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/exams" className="text-xs mb-2 block hover:underline" style={{ color: 'var(--text-muted)' }}>← Concursos</Link>
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {exam.is_primary && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>★ Foco principal</span>
            )}
            {exam.organization && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>{exam.organization}</span>
            )}
            {!exam.exam_date && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>📂 Pré-edital</span>
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>{exam.name}</h1>
          {exam.exam_date ? (
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Prova: {format(parseISO(exam.exam_date), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          ) : (
            <p className="text-sm mt-1" style={{ color: 'var(--warning)' }}>Sem data definida — estudando com edital anterior como referência</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/exams/${id}/edit`} className="text-xs px-3 py-1.5 rounded-lg border transition-colors" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            ✏️ Editar
          </Link>
          <button onClick={deleteExam} className="text-xs px-3 py-1.5 rounded-lg border transition-colors" style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}>
            Excluir
          </button>
        </div>
      </div>

      {/* Progress overview */}
      <div className="rounded-2xl border p-6 grid grid-cols-3 gap-6" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        <div>
          <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Progresso geral</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--text)' }}>{overallPercent}<span className="text-lg" style={{ color: 'var(--text-muted)' }}>%</span></p>
          <div className="h-2 rounded-full mt-3 overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{ width: `${overallPercent}%`, background: 'linear-gradient(90deg, var(--primary-strong), var(--primary))' }}
            />
          </div>
        </div>
        <div className="border-l pl-6" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Matérias</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--text)' }}>{subjects.length}</p>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-subtle)' }}>no edital</p>
        </div>
        <div className="border-l pl-6" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Tópicos</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--text)' }}>{totalTopics}</p>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-subtle)' }}>para estudar</p>
        </div>
      </div>

      {/* Subjects list */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Matérias</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Clique em uma matéria para ver os tópicos</p>
          </div>
          <button
            onClick={() => setShowAddSubject(true)}
            className="text-xs px-3 py-2 rounded-lg font-medium transition-colors"
            style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}
          >
            + Adicionar matéria
          </button>
        </div>

        {showAddSubject && (
          <div className="rounded-xl border p-4 flex items-center gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--primary)' }}>
            <input
              type="text"
              placeholder="Nome da matéria"
              value={newSubjectName}
              onChange={e => setNewSubjectName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSubject()}
              autoFocus
              style={{ flex: 1 }}
            />
            <button onClick={addSubject} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
              {saving ? '...' : 'Adicionar'}
            </button>
            <button onClick={() => setShowAddSubject(false)} className="text-sm" style={{ color: 'var(--text-subtle)' }}>✕</button>
          </div>
        )}

        {subjects.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-dashed" style={{ borderColor: 'var(--border)' }}>
            <div className="text-3xl mb-2 opacity-40">📚</div>
            <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>Nenhuma matéria adicionada ainda.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {subjects.map(subject => (
              <SubjectCard
                key={subject.id}
                subject={subject}
                expanded={expandedSubject === subject.id}
                onToggle={() => setExpandedSubject(expandedSubject === subject.id ? null : subject.id)}
                onRefresh={loadData}
                onOpenLog={(topicId, topicName) => setLogModal({ topicId, topicName, subjectName: subject.name })}
              />
            ))}
          </div>
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

function SubjectCard({
  subject, expanded, onToggle, onRefresh, onOpenLog
}: {
  subject: SubjectWithProgress
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

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all"
      style={{
        background: 'var(--surface)',
        borderColor: expanded ? subject.color : 'var(--border)',
        boxShadow: expanded ? 'var(--shadow-md)' : 'var(--shadow-sm)',
      }}
    >
      <button
        onClick={onToggle}
        className="w-full text-left transition-colors relative"
        style={{ background: expanded ? 'var(--surface-hover)' : 'transparent' }}
      >
        {/* Left color accent strip */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ background: subject.color }}
        />

        <div className="pl-5 pr-5 py-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{subject.name}</h3>
              <span
                className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}
              >
                {subject.topics.length}
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {completedTopics === 0 && subject.topics.length > 0 && 'Não iniciado'}
              {completedTopics > 0 && completedTopics < subject.topics.length && `${completedTopics}/${subject.topics.length} tópicos completos`}
              {completedTopics === subject.topics.length && subject.topics.length > 0 && '✓ Todos os tópicos completos'}
              {subject.topics.length === 0 && 'Sem tópicos ainda'}
            </p>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="flex flex-col items-end">
              <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--text)' }}>{subject.percent}%</span>
              <div className="w-28 h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
                <div
                  className="h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${subject.percent}%`, background: subject.color }}
                />
              </div>
            </div>
            <span
              className="text-xs transition-transform"
              style={{ color: 'var(--text-subtle)', transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}
            >
              ▼
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {subject.topics.length === 0 ? (
            <p className="px-5 py-6 text-sm text-center" style={{ color: 'var(--text-subtle)' }}>Nenhum tópico ainda. Adicione um abaixo.</p>
          ) : (
            <ul className="py-1">
              {subject.topics.map(topic => (
                <TopicRow key={topic.id} topic={topic} onLog={() => onOpenLog(topic.id, topic.name)} />
              ))}
            </ul>
          )}

          {/* Add topic */}
          <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
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
                <button onClick={addTopic} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--primary-strong)', color: '#fff' }}>
                  Adicionar
                </button>
                <button onClick={() => setShowAddTopic(false)} className="text-xs" style={{ color: 'var(--text-subtle)' }}>✕</button>
              </div>
            ) : (
              <button onClick={() => setShowAddTopic(true)} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>
                + Adicionar tópico
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TopicRow({
  topic, onLog,
}: {
  topic: { id: string; name: string; completedActivities: ActivityType[]; percent: number; lastExerciseScore: number | null }
  onLog: () => void
}) {
  const activities: ActivityType[] = ['video', 'reading', 'exercises', 'review']
  const done = topic.percent === 100

  return (
    <li
      className="px-5 py-3 flex items-center gap-4 transition-colors hover:bg-[var(--surface-hover)]"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* Status dot */}
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          background: done ? 'var(--success)' : topic.completedActivities.length > 0 ? 'var(--warning)' : 'var(--border-strong)',
        }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm" style={{ color: 'var(--text)' }}>{topic.name}</p>
          {topic.lastExerciseScore !== null && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-md font-medium tabular-nums"
              style={{
                background: topic.lastExerciseScore < EXERCISE_THRESHOLD ? 'var(--danger-soft)' : 'var(--success-soft)',
                color: topic.lastExerciseScore < EXERCISE_THRESHOLD ? 'var(--danger)' : 'var(--success)',
              }}
            >
              ✏️ {topic.lastExerciseScore}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          {activities.map(act => {
            const isDone = topic.completedActivities.includes(act)
            return (
              <span
                key={act}
                title={ACTIVITY_LABELS[act]}
                className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-opacity"
                style={{
                  background: isDone ? 'var(--success-soft)' : 'transparent',
                  color: isDone ? 'var(--success)' : 'var(--text-subtle)',
                  border: `1px solid ${isDone ? 'transparent' : 'var(--border)'}`,
                  opacity: isDone ? 1 : 0.6,
                }}
              >
                <span>{ACTIVITY_ICONS[act]}</span>
                <span>{ACTIVITY_LABELS[act]}</span>
              </span>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>{topic.percent}%</span>
        <button
          onClick={onLog}
          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
          style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}
        >
          + Registrar
        </button>
      </div>
    </li>
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--primary)' }}>{subjectName}</p>
              <h2 className="text-base font-semibold leading-tight" style={{ color: 'var(--text)' }}>{topicName}</h2>
            </div>
            <button onClick={onClose} className="text-lg leading-none mt-0.5" style={{ color: 'var(--text-subtle)' }}>✕</button>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>O que você estudou agora?</p>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {ACTIVITIES.map(a => (
              <button
                key={a.type}
                onClick={() => setActivity(a.type)}
                className="flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-all"
                style={{
                  background: activity === a.type ? 'var(--primary-soft)' : 'var(--surface-hover)',
                  borderColor: activity === a.type ? 'var(--primary)' : 'var(--border)',
                }}
              >
                <span className="text-xl">{a.icon}</span>
                <div>
                  <p className="text-sm font-medium" style={{ color: activity === a.type ? 'var(--primary-soft-text)' : 'var(--text)' }}>{a.label}</p>
                  <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>{a.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {activity === 'exercises' && (
            <div className="rounded-xl border p-4 space-y-4" style={{ background: 'var(--surface-hover)', borderColor: 'var(--border)' }}>
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Resultado das questões</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Total</label>
                  <input type="number" min="1" placeholder="50" value={total} onChange={e => setTotal(e.target.value)} className="w-full" style={{ textAlign: 'center' }} />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--success)' }}>✓ Acertos</label>
                  <input type="number" min="0" max={total || undefined} placeholder="40" value={correct} onChange={e => setCorrect(e.target.value)} className="w-full" style={{ textAlign: 'center' }} />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--danger)' }}>✗ Erros</label>
                  <div className="w-full rounded-lg px-3 py-2 text-center text-sm font-medium" style={{ background: 'var(--surface)', color: wrongNum > 0 ? 'var(--danger)' : 'var(--text-subtle)', border: '1px solid var(--border)' }}>
                    {totalNum > 0 ? wrongNum : '—'}
                  </div>
                </div>
              </div>

              {pct !== null && totalNum > 0 && (
                <div
                  className="rounded-xl p-3 flex items-center justify-between"
                  style={{
                    background: needsRevision ? 'var(--danger-soft)' : 'var(--success-soft)',
                    border: `1px solid ${needsRevision ? 'var(--danger)' : 'var(--success)'}`,
                  }}
                >
                  <div>
                    <p className="text-2xl font-bold" style={{ color: needsRevision ? 'var(--danger)' : 'var(--success)' }}>{pct}%</p>
                    <p className="text-xs mt-0.5" style={{ color: needsRevision ? 'var(--danger)' : 'var(--success)' }}>
                      {needsRevision ? `⚠️ Abaixo de ${EXERCISE_THRESHOLD}% — revisão agendada` : `✓ Aprovado! Acima de ${EXERCISE_THRESHOLD}%`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>Meta</p>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>{EXERCISE_THRESHOLD}%</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activity && (
            <div className="flex gap-3">
              <div style={{ width: '130px', flexShrink: 0 }}>
                <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Duração (min)</label>
                <input type="number" min="1" placeholder="45" value={duration} onChange={e => setDuration(e.target.value)} className="w-full" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Observações (opcional)</label>
                <input type="text" placeholder="Ex: revisar questões 12-18" value={notes} onChange={e => setNotes(e.target.value)} className="w-full" />
              </div>
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ background: 'var(--primary-strong)', color: '#fff' }}
          >
            {saving ? 'Salvando...' : 'Salvar registro'}
          </button>
        </div>
      </div>
    </div>
  )
}
