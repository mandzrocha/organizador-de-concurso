'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Exam, Subject, Topic, StudyLog, ACTIVITY_LABELS, ACTIVITY_ICONS, ActivityType } from '@/lib/types'
import { getTopicCompletionPercent } from '@/lib/progress'
import { deleteExamCascade } from '@/lib/exam-actions'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ArrowLeft, Star, FolderOpen, Pencil, Trash2, Plus, ChevronDown, MoreVertical,
  GripVertical, ArrowUpDown, ArrowLeftRight, ArrowUp, ArrowDown, Check, RotateCcw,
  Play, BookOpen, PenLine, RotateCw, X, CheckCircle2, Sparkles, BookMarked,
} from 'lucide-react'

interface TopicWithProgress extends Topic {
  completedActivities: ActivityType[]
  percent: number
  lastExerciseScore: number | null
}

interface SubjectWithProgress extends Subject {
  examSubjectId: string
  completedAt: string | null
  topics: TopicWithProgress[]
  percent: number
}

interface LogModal {
  topicId: string
  topicName: string
  subjectName: string
}

type LucideIcon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>

const ACTIVITIES: { type: ActivityType; Icon: LucideIcon; label: string; desc: string }[] = [
  { type: 'video',      Icon: Play,    label: 'Videoaula',  desc: 'Assistiu aula em vídeo' },
  { type: 'reading',    Icon: BookOpen, label: 'Leitura',   desc: 'Leu apostila ou livro' },
  { type: 'exercises',  Icon: PenLine, label: 'Exercícios', desc: 'Resolveu questões' },
  { type: 'review',     Icon: RotateCw, label: 'Revisão',   desc: 'Revisou o conteúdo' },
]
const ACTIVITY_ICON_MAP: Record<ActivityType, LucideIcon> = {
  video: Play, reading: BookOpen, exercises: PenLine, review: RotateCw,
}

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
  const [moveTopic, setMoveTopic] = useState<{ topicId: string; currentSubjectId: string; topicName: string } | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  useEffect(() => { loadData() }, [id])

  async function persistOrder(items: SubjectWithProgress[]) {
    // Persist order_index for each exam_subject in parallel
    await Promise.all(items.map((s, i) =>
      supabase.from('exam_subjects').update({ order_index: i }).eq('id', s.examSubjectId)
    ))
  }

  function reorderSubjects(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    setSubjects(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      // fire-and-forget; UI already updated
      persistOrder(next)
      return next
    })
  }

  function moveSubject(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= subjects.length) return
    reorderSubjects(index, target)
  }

  async function loadData() {
    const [examRes, esRes] = await Promise.all([
      supabase.from('exams').select('*').eq('id', id).single(),
      supabase.from('exam_subjects').select('*, subject:subjects(*)').eq('exam_id', id).order('order_index'),
    ])

    if (examRes.error) { router.push('/exams'); return }
    setExam(examRes.data)

    const examSubjectRows = esRes.data || []
    const subjectIds = examSubjectRows.map(es => es.subject_id)

    const [topicsRes, logsRes] = await Promise.all([
      // Topics são SEMPRE escopados por exam_id. Filtro estrito = topicos de
      // outros concursos nunca aparecem aqui mesmo se as materias forem
      // compartilhadas (caso clássico: BB e TJSP ambos com 'Lingua Portuguesa').
      supabase
        .from('topics')
        .select('*')
        .in('subject_id', subjectIds.length ? subjectIds : ['x'])
        .eq('exam_id', id)
        .order('order_index'),
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

    const withProgress: SubjectWithProgress[] = examSubjectRows.map(es => {
      const subject = es.subject as Subject
      const subTopics: TopicWithProgress[] = topics.filter(t => t.subject_id === subject.id).map(topic => {
        const completed = [...(completedByTopic[topic.id] || [])] as ActivityType[]
        return {
          ...topic,
          completedActivities: completed,
          percent: getTopicCompletionPercent(completed, topic.completed_at),
          lastExerciseScore: lastExerciseByTopic[topic.id] ?? null,
        }
      })
      const percent = subTopics.length ? Math.round(subTopics.reduce((s, t) => s + t.percent, 0) / subTopics.length) : 0
      return {
        ...subject,
        examSubjectId: es.id,
        completedAt: es.completed_at ?? null,
        topics: subTopics,
        percent,
      }
    })

    setSubjects(withProgress)
    setLoading(false)
  }

  async function addSubject() {
    if (!newSubjectName.trim()) return
    setSaving(true)
    const { data: existing } = await supabase.from('subjects').select('id').eq('name', newSubjectName.trim()).maybeSingle()
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
    const ok = confirm(
      `Excluir "${exam?.name}"?\n\n` +
      `Isso vai apagar TODAS as matérias vinculadas a este concurso, os tópicos, ` +
      `o histórico de estudos e os planos do calendário. Esta ação NÃO pode ser desfeita.`
    )
    if (!ok) return
    try {
      await deleteExamCascade(supabase, id)
      router.push('/exams')
    } catch (e: any) {
      alert('Erro ao excluir: ' + e.message)
    }
  }

  async function renameSubject(subjectId: string, newName: string) {
    if (!newName.trim()) return
    await supabase.from('subjects').update({ name: newName.trim() }).eq('id', subjectId)
    loadData()
  }

  async function toggleSubjectComplete(examSubjectId: string, currentCompletedAt: string | null) {
    const value = currentCompletedAt ? null : new Date().toISOString().split('T')[0]
    await supabase.from('exam_subjects').update({ completed_at: value }).eq('id', examSubjectId)
    loadData()
  }

  async function removeSubjectFromExam(examSubjectId: string, subjectName: string) {
    if (!confirm(`Remover "${subjectName}" deste concurso? Os tópicos e o histórico continuam salvos.`)) return
    await supabase.from('exam_subjects').delete().eq('id', examSubjectId)
    loadData()
  }

  async function moveTopicToSubject(topicId: string, newSubjectId: string) {
    await supabase.from('topics').update({ subject_id: newSubjectId }).eq('id', topicId)
    setMoveTopic(null)
    loadData()
  }

  async function deleteTopic(topicId: string, topicName: string) {
    if (!confirm(`Excluir o tópico "${topicName}"? Os registros de estudo serão removidos.`)) return
    await supabase.from('topics').delete().eq('id', topicId)
    loadData()
  }

  async function renameTopic(topicId: string, newName: string) {
    if (!newName.trim()) return
    await supabase.from('topics').update({ name: newName.trim() }).eq('id', topicId)
    loadData()
  }

  async function persistTopicOrder(items: TopicWithProgress[]) {
    await Promise.all(items.map((t, i) =>
      supabase.from('topics').update({ order_index: i }).eq('id', t.id)
    ))
  }

  function reorderTopics(subjectId: string, fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    setSubjects(prev => prev.map(sub => {
      if (sub.id !== subjectId) return sub
      const next = [...sub.topics]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      persistTopicOrder(next)
      return { ...sub, topics: next }
    }))
  }

  function moveTopicInSubject(subjectId: string, index: number, direction: -1 | 1) {
    const sub = subjects.find(s => s.id === subjectId)
    if (!sub) return
    const target = index + direction
    if (target < 0 || target >= sub.topics.length) return
    reorderTopics(subjectId, index, target)
  }

  async function toggleTopicComplete(topicId: string, currentCompletedAt: string | null) {
    const value = currentCompletedAt ? null : new Date().toISOString().split('T')[0]
    await supabase.from('topics').update({ completed_at: value }).eq('id', topicId)

    // If marking complete and no revision schedule exists, create one so reviews continue
    if (value) {
      const { data: existing } = await supabase.from('revision_schedule').select('id').eq('topic_id', topicId).maybeSingle()
      if (!existing) {
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
        await supabase.from('revision_schedule').insert({
          topic_id: topicId,
          next_review: tomorrow.toISOString().split('T')[0],
          last_reviewed: new Date().toISOString().split('T')[0],
        })
      }
    }
    loadData()
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
          <Link href="/exams" className="text-xs mb-2 inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--text-muted)' }}>
            <ArrowLeft size={12} /> Concursos
          </Link>
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {exam.is_primary && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
                <Star size={11} fill="currentColor" strokeWidth={0} /> Foco principal
              </span>
            )}
            {exam.organization && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>{exam.organization}</span>
            )}
            {!exam.exam_date && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                <FolderOpen size={11} /> Pré-edital
              </span>
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
          <Link href={`/exams/${id}/edit`} className="text-xs px-3 py-1.5 rounded-lg border transition-colors inline-flex items-center gap-1.5" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            <Pencil size={12} /> Editar
          </Link>
          <button onClick={deleteExam} className="text-xs px-3 py-1.5 rounded-lg border transition-colors inline-flex items-center gap-1.5" style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}>
            <Trash2 size={12} /> Excluir
          </button>
        </div>
      </div>

      {/* Progress overview */}
      <div className="rounded-2xl border p-6 grid grid-cols-3 gap-6" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        <div>
          <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Progresso geral</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--text)' }}>{overallPercent}<span className="text-lg" style={{ color: 'var(--text-muted)' }}>%</span></p>
          <div className="h-2 rounded-full mt-3 overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
            <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${overallPercent}%`, background: 'linear-gradient(90deg, var(--primary-strong), var(--primary))' }} />
          </div>
        </div>
        <div className="border-l pl-6" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Matérias</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--text)' }}>{subjects.length}</p>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-subtle)' }}>
            {subjects.filter(s => s.completedAt).length} concluídas
          </p>
        </div>
        <div className="border-l pl-6" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Tópicos</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--text)' }}>{totalTopics}</p>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-subtle)' }}>para estudar</p>
        </div>
      </div>

      {/* Subjects */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Matérias</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Clique para ver os tópicos · arraste para reordenar · use o menu ⋮ para editar</p>
          </div>
          <button onClick={() => setShowAddSubject(true)} className="text-xs px-3 py-2 rounded-lg font-medium transition-colors inline-flex items-center gap-1.5" style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}>
            <Plus size={12} strokeWidth={2.5} /> Adicionar matéria
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
            <BookMarked size={40} strokeWidth={1.25} className="mx-auto mb-2" style={{ color: 'var(--text-subtle)', opacity: 0.6 }} />
            <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>Nenhuma matéria adicionada ainda.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {subjects.map((subject, index) => (
              <SubjectCard
                key={subject.examSubjectId}
                subject={subject}
                examId={id}
                index={index}
                total={subjects.length}
                isDragging={dragIndex === index}
                isDragOver={dragOverIndex === index && dragIndex !== index}
                onDragStart={() => setDragIndex(index)}
                onDragEnter={() => setDragOverIndex(index)}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== index) reorderSubjects(dragIndex, index)
                  setDragIndex(null); setDragOverIndex(null)
                }}
                onMoveUp={() => moveSubject(index, -1)}
                onMoveDown={() => moveSubject(index, 1)}
                expanded={expandedSubject === subject.id}
                onToggle={() => setExpandedSubject(expandedSubject === subject.id ? null : subject.id)}
                onRefresh={loadData}
                onOpenLog={(topicId, topicName) => setLogModal({ topicId, topicName, subjectName: subject.name })}
                onRename={(newName) => renameSubject(subject.id, newName)}
                onToggleComplete={() => toggleSubjectComplete(subject.examSubjectId, subject.completedAt)}
                onRemove={() => removeSubjectFromExam(subject.examSubjectId, subject.name)}
                onMoveTopic={(topicId, topicName) => setMoveTopic({ topicId, currentSubjectId: subject.id, topicName })}
                onRenameTopic={renameTopic}
                onDeleteTopic={deleteTopic}
                onToggleTopicComplete={toggleTopicComplete}
                onReorderTopics={(from, to) => reorderTopics(subject.id, from, to)}
                onMoveTopicInSubject={(i, dir) => moveTopicInSubject(subject.id, i, dir)}
              />
            ))}
          </div>
        )}
      </div>

      {logModal && (
        <LogStudyModal
          topicId={logModal.topicId}
          topicName={logModal.topicName}
          subjectName={logModal.subjectName}
          onClose={() => setLogModal(null)}
          onSaved={() => { setLogModal(null); loadData() }}
        />
      )}

      {moveTopic && (
        <MoveTopicModal
          topicName={moveTopic.topicName}
          subjects={subjects.filter(s => s.id !== moveTopic.currentSubjectId)}
          onClose={() => setMoveTopic(null)}
          onMove={(newSubjectId) => moveTopicToSubject(moveTopic.topicId, newSubjectId)}
          onCreateAndMove={async (newName) => {
            const { data: existing } = await supabase.from('subjects').select('id').eq('name', newName.trim()).maybeSingle()
            let newSubjectId: string
            if (existing) {
              newSubjectId = existing.id
            } else {
              const { data: newSub } = await supabase.from('subjects').insert({ name: newName.trim() }).select().single()
              newSubjectId = newSub!.id
            }
            await supabase.from('exam_subjects').upsert({ exam_id: id, subject_id: newSubjectId })
            await moveTopicToSubject(moveTopic.topicId, newSubjectId)
          }}
        />
      )}
    </div>
  )
}

function SubjectCard({
  subject, examId, index, total, isDragging, isDragOver,
  onDragStart, onDragEnter, onDragEnd, onDrop, onMoveUp, onMoveDown,
  expanded, onToggle, onRefresh, onOpenLog,
  onRename, onToggleComplete, onRemove, onMoveTopic, onRenameTopic, onDeleteTopic, onToggleTopicComplete,
  onReorderTopics, onMoveTopicInSubject,
}: {
  subject: SubjectWithProgress
  examId: string
  index: number
  total: number
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDragEnd: () => void
  onDrop: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  expanded: boolean
  onToggle: () => void
  onRefresh: () => void
  onOpenLog: (topicId: string, topicName: string) => void
  onRename: (newName: string) => void
  onToggleComplete: () => void
  onRemove: () => void
  onMoveTopic: (topicId: string, topicName: string) => void
  onRenameTopic: (topicId: string, newName: string) => void
  onDeleteTopic: (topicId: string, topicName: string) => void
  onToggleTopicComplete: (topicId: string, currentCompletedAt: string | null) => void
  onReorderTopics: (fromIndex: number, toIndex: number) => void
  onMoveTopicInSubject: (index: number, direction: -1 | 1) => void
}) {
  const supabase = createClient()
  const [showAddTopic, setShowAddTopic] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(subject.name)
  const menuRef = useRef<HTMLDivElement>(null)
  const [topicDragIndex, setTopicDragIndex] = useState<number | null>(null)
  const [topicDragOverIndex, setTopicDragOverIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  async function addTopic() {
    if (!newTopicName.trim()) return
    await supabase.from('topics').insert({
      subject_id: subject.id,
      exam_id: examId,
      name: newTopicName.trim(),
      order_index: subject.topics.length,
    })
    setNewTopicName('')
    setShowAddTopic(false)
    onRefresh()
  }

  const completedTopics = subject.topics.filter(t => t.percent === 100).length
  const startedTopics = subject.topics.filter(t => t.completedActivities.length > 0 || t.completed_at).length
  const isCompleted = !!subject.completedAt

  // Smart status label
  let statusLabel: string
  if (subject.topics.length === 0) {
    statusLabel = 'Sem tópicos ainda'
  } else if (isCompleted) {
    statusLabel = `✓ Concluída em ${format(parseISO(subject.completedAt!), "d 'de' MMM", { locale: ptBR })}`
  } else if (startedTopics === 0) {
    statusLabel = 'Não iniciada'
  } else if (completedTopics === subject.topics.length) {
    statusLabel = '✓ Todos os tópicos completos'
  } else if (completedTopics > 0) {
    statusLabel = `${completedTopics}/${subject.topics.length} tópicos completos · ${startedTopics} iniciados`
  } else {
    statusLabel = `Em andamento · ${startedTopics}/${subject.topics.length} iniciados`
  }

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      className="rounded-2xl border overflow-hidden transition-all"
      style={{
        background: 'var(--surface)',
        borderColor: isDragOver ? 'var(--primary)' : expanded ? subject.color : isCompleted ? 'var(--success)' : 'var(--border)',
        boxShadow: isDragOver ? 'var(--shadow-lg)' : expanded ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        opacity: isDragging ? 0.4 : isCompleted && !expanded ? 0.85 : 1,
        transform: isDragOver ? 'translateY(-2px)' : 'none',
      }}
    >
      <div className="relative">
        {/* Color accent strip */}
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: subject.color }} />

        <div className="pl-3 pr-3 py-4 flex items-center gap-2">
          {/* Drag handle */}
          <div
            className="flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
            style={{ color: 'var(--text-subtle)' }}
            title="Arraste para reordenar"
          >
            <GripVertical size={14} />
          </div>

          <button onClick={onToggle} className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2 flex-wrap">
              {renaming ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onRename(renameValue); setRenaming(false) }
                    if (e.key === 'Escape') { setRenameValue(subject.name); setRenaming(false) }
                  }}
                  onBlur={() => { onRename(renameValue); setRenaming(false) }}
                  onClick={e => e.stopPropagation()}
                  autoFocus
                  className="text-base font-semibold"
                  style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text)' }}
                />
              ) : (
                <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{subject.name}</h3>
              )}
              <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                {subject.topics.length}
              </span>
              {isCompleted && (
                <span className="text-xs px-1.5 py-0.5 rounded-md font-medium inline-flex items-center gap-1" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                  <CheckCircle2 size={11} /> Concluída
                </span>
              )}
            </div>
            <p className="text-xs mt-1" style={{ color: isCompleted ? 'var(--success)' : 'var(--text-muted)' }}>{statusLabel}</p>
          </button>

          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex flex-col items-end">
              <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--text)' }}>{subject.percent}%</span>
              <div className="w-28 h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
                <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${subject.percent}%`, background: subject.color }} />
              </div>
            </div>

            {/* Menu */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: 'var(--text-muted)' }}
                title="Opções"
              >
                <MoreVertical size={16} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-9 z-10 w-48 rounded-xl border overflow-hidden"
                  style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}
                >
                  <button
                    onClick={() => { setRenaming(true); setMenuOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)] inline-flex items-center gap-2"
                    style={{ color: 'var(--text)' }}
                  >
                    <Pencil size={13} /> Renomear
                  </button>
                  <button
                    onClick={() => { onMoveUp(); setMenuOpen(false) }}
                    disabled={index === 0}
                    className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40 inline-flex items-center gap-2"
                    style={{ color: 'var(--text)' }}
                  >
                    <ArrowUp size={13} /> Mover para cima
                  </button>
                  <button
                    onClick={() => { onMoveDown(); setMenuOpen(false) }}
                    disabled={index === total - 1}
                    className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40 inline-flex items-center gap-2"
                    style={{ color: 'var(--text)' }}
                  >
                    <ArrowDown size={13} /> Mover para baixo
                  </button>
                  <button
                    onClick={() => { onToggleComplete(); setMenuOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)] inline-flex items-center gap-2"
                    style={{ color: isCompleted ? 'var(--warning)' : 'var(--success)', borderTop: '1px solid var(--border)' }}
                  >
                    {isCompleted ? <><RotateCcw size={13} /> Desmarcar conclusão</> : <><Check size={13} /> Marcar como concluída</>}
                  </button>
                  <button
                    onClick={() => { onRemove(); setMenuOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--danger-soft)] inline-flex items-center gap-2"
                    style={{ color: 'var(--danger)', borderTop: '1px solid var(--border)' }}
                  >
                    <Trash2 size={13} /> Remover do concurso
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={onToggle}
              className="transition-transform px-1 flex items-center"
              style={{ color: 'var(--text-subtle)', transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {subject.topics.length === 0 ? (
            <p className="px-5 py-6 text-sm text-center" style={{ color: 'var(--text-subtle)' }}>Nenhum tópico ainda. Adicione um abaixo.</p>
          ) : (
            <ul className="py-1">
              {subject.topics.map((topic, ti) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  index={ti}
                  total={subject.topics.length}
                  isDragging={topicDragIndex === ti}
                  isDragOver={topicDragOverIndex === ti && topicDragIndex !== ti}
                  onDragStart={() => setTopicDragIndex(ti)}
                  onDragEnter={() => setTopicDragOverIndex(ti)}
                  onDragEnd={() => { setTopicDragIndex(null); setTopicDragOverIndex(null) }}
                  onDrop={() => {
                    if (topicDragIndex !== null && topicDragIndex !== ti) onReorderTopics(topicDragIndex, ti)
                    setTopicDragIndex(null); setTopicDragOverIndex(null)
                  }}
                  onMoveUp={() => onMoveTopicInSubject(ti, -1)}
                  onMoveDown={() => onMoveTopicInSubject(ti, 1)}
                  onLog={() => onOpenLog(topic.id, topic.name)}
                  onMove={() => onMoveTopic(topic.id, topic.name)}
                  onRename={(newName) => onRenameTopic(topic.id, newName)}
                  onDelete={() => onDeleteTopic(topic.id, topic.name)}
                  onToggleComplete={() => onToggleTopicComplete(topic.id, topic.completed_at)}
                />
              ))}
            </ul>
          )}

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
              <button onClick={() => setShowAddTopic(true)} className="text-xs font-medium inline-flex items-center gap-1.5" style={{ color: 'var(--primary)' }}>
                <Plus size={12} strokeWidth={2.5} /> Adicionar tópico
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TopicRow({
  topic, index, total, isDragging, isDragOver,
  onDragStart, onDragEnter, onDragEnd, onDrop, onMoveUp, onMoveDown,
  onLog, onMove, onRename, onDelete, onToggleComplete,
}: {
  topic: TopicWithProgress
  index: number
  total: number
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDragEnd: () => void
  onDrop: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onLog: () => void
  onMove: () => void
  onRename: (newName: string) => void
  onDelete: () => void
  onToggleComplete: () => void
}) {
  const activities: ActivityType[] = ['video', 'reading', 'exercises', 'review']
  const manuallyComplete = !!topic.completed_at
  const fullyDone = topic.completedActivities.length === 4
  const done = manuallyComplete || fullyDone
  const started = topic.completedActivities.length > 0
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(topic.name)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <li
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      className="px-5 py-4 transition-all hover:bg-[var(--surface-hover)]"
      style={{
        borderBottom: '1px solid var(--border)',
        opacity: isDragging ? 0.4 : 1,
        background: isDragOver ? 'var(--primary-soft)' : 'transparent',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <div
          className="flex items-center justify-center cursor-grab active:cursor-grabbing select-none mt-1"
          style={{ color: 'var(--text-subtle)' }}
          title="Arraste para reordenar"
        >
          <GripVertical size={12} />
        </div>

        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5"
          style={{ background: done ? 'var(--success)' : started ? 'var(--warning)' : 'var(--border-strong)' }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {renaming ? (
              <input
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { onRename(renameValue); setRenaming(false) }
                  if (e.key === 'Escape') { setRenameValue(topic.name); setRenaming(false) }
                }}
                onBlur={() => { onRename(renameValue); setRenaming(false) }}
                autoFocus
                className="text-sm"
                style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text)', flex: 1 }}
              />
            ) : (
              <p
                className="text-sm font-medium"
                style={{
                  color: done ? 'var(--text-muted)' : 'var(--text)',
                  textDecorationLine: manuallyComplete ? 'line-through' : 'none',
                  textDecorationColor: 'var(--text-subtle)',
                }}
              >
                {topic.name}
              </p>
            )}

            {manuallyComplete && (
              <span className="text-xs px-2 py-0.5 rounded-md font-medium inline-flex items-center gap-1" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                <Check size={11} strokeWidth={2.5} /> Concluído
              </span>
            )}
            {topic.lastExerciseScore !== null && (
              <span
                className="text-xs px-2 py-0.5 rounded-md font-medium tabular-nums inline-flex items-center gap-1"
                style={{
                  background: topic.lastExerciseScore < EXERCISE_THRESHOLD ? 'var(--danger-soft)' : 'var(--success-soft)',
                  color: topic.lastExerciseScore < EXERCISE_THRESHOLD ? 'var(--danger)' : 'var(--success)',
                }}
              >
                <PenLine size={11} /> {topic.lastExerciseScore}%
              </span>
            )}
          </div>

          {/* Bigger activity pills */}
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            {activities.map(act => {
              const isDone = topic.completedActivities.includes(act)
              const Icon = ACTIVITY_ICON_MAP[act]
              return (
                <span
                  key={act}
                  className="text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-all"
                  style={{
                    background: isDone ? 'var(--success-soft)' : 'transparent',
                    color: isDone ? 'var(--success)' : 'var(--text-subtle)',
                    border: `1px solid ${isDone ? 'transparent' : 'var(--border)'}`,
                  }}
                >
                  <Icon size={12} />
                  <span>{ACTIVITY_LABELS[act]}</span>
                  {isDone && <Check size={11} strokeWidth={2.5} />}
                </span>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-semibold tabular-nums" style={{ color: done ? 'var(--success)' : 'var(--text-muted)' }}>{topic.percent}%</span>

          <button
            onClick={onToggleComplete}
            className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
            style={{
              background: manuallyComplete ? 'var(--surface-hover)' : 'var(--success-soft)',
              color: manuallyComplete ? 'var(--text-muted)' : 'var(--success)',
              border: `1px solid ${manuallyComplete ? 'var(--border)' : 'transparent'}`,
            }}
            title={manuallyComplete ? 'Desmarcar conclusão' : 'Marcar tópico como concluído'}
          >
            {manuallyComplete ? <><RotateCcw size={12} /> Reabrir</> : <><Check size={12} strokeWidth={2.5} /> Concluir</>}
          </button>

          <button
            onClick={onLog}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
            style={{ background: 'var(--primary-soft)', color: 'var(--primary-soft-text)' }}
          >
            <Plus size={12} strokeWidth={2.5} /> Registrar
          </button>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-7 h-7 rounded-md flex items-center justify-center"
              style={{ color: 'var(--text-muted)' }}
              title="Opções"
            >
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-8 z-10 w-48 rounded-xl border overflow-hidden"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}
              >
                <button onClick={() => { setRenaming(true); setMenuOpen(false) }} className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-hover)] inline-flex items-center gap-2" style={{ color: 'var(--text)' }}>
                  <Pencil size={12} /> Renomear
                </button>
                <button
                  onClick={() => { onMoveUp(); setMenuOpen(false) }}
                  disabled={index === 0}
                  className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40 inline-flex items-center gap-2"
                  style={{ color: 'var(--text)' }}
                >
                  <ArrowUp size={12} /> Mover para cima
                </button>
                <button
                  onClick={() => { onMoveDown(); setMenuOpen(false) }}
                  disabled={index === total - 1}
                  className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40 inline-flex items-center gap-2"
                  style={{ color: 'var(--text)' }}
                >
                  <ArrowDown size={12} /> Mover para baixo
                </button>
                <button onClick={() => { onMove(); setMenuOpen(false) }} className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-hover)] inline-flex items-center gap-2" style={{ color: 'var(--text)', borderTop: '1px solid var(--border)' }}>
                  <ArrowLeftRight size={12} /> Mover para outra matéria
                </button>
                <button onClick={() => { onDelete(); setMenuOpen(false) }} className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[var(--danger-soft)] inline-flex items-center gap-2" style={{ color: 'var(--danger)', borderTop: '1px solid var(--border)' }}>
                  <Trash2 size={12} /> Excluir tópico
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

function MoveTopicModal({
  topicName, subjects, onClose, onMove, onCreateAndMove,
}: {
  topicName: string
  subjects: SubjectWithProgress[]
  onClose: () => void
  onMove: (newSubjectId: string) => void
  onCreateAndMove: (newName: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Mover tópico</p>
              <h2 className="text-base font-semibold mt-0.5" style={{ color: 'var(--text)' }}>{topicName}</h2>
            </div>
            <button onClick={onClose} style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
          </div>
        </div>

        <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          {creating ? (
            <div className="space-y-2">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nome da nova matéria:</p>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && newName.trim() && onCreateAndMove(newName)}
                placeholder="Ex: Direito Civil — Parte Especial"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={() => setCreating(false)} className="px-3 py-2 rounded-lg text-xs" style={{ color: 'var(--text-muted)' }}>← Voltar</button>
                <button
                  onClick={() => newName.trim() && onCreateAndMove(newName)}
                  disabled={!newName.trim()}
                  className="flex-1 py-2 rounded-lg text-xs font-medium disabled:opacity-40"
                  style={{ background: 'var(--primary-strong)', color: '#fff' }}
                >
                  Criar e mover
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => setCreating(true)}
                className="w-full px-3 py-3 rounded-lg border border-dashed text-sm font-medium text-left inline-flex items-center gap-2"
                style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
              >
                <Plus size={14} strokeWidth={2.5} /> Criar nova matéria e mover
              </button>
              <p className="text-xs uppercase tracking-wider mt-3 mb-1 px-1" style={{ color: 'var(--text-subtle)' }}>Matérias existentes</p>
              {subjects.length === 0 ? (
                <p className="text-xs px-3 py-2" style={{ color: 'var(--text-subtle)' }}>Nenhuma outra matéria. Crie uma nova acima.</p>
              ) : (
                subjects.map(s => (
                  <button
                    key={s.id}
                    onClick={() => onMove(s.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                    <span className="text-sm flex-1" style={{ color: 'var(--text)' }}>{s.name}</span>
                    <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>{s.topics.length} tópicos</span>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>
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

  const canSave = activity !== null && (activity !== 'exercises' || (totalNum > 0 && correctNum >= 0 && correctNum <= totalNum))

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

    const { data: existing } = await supabase.from('revision_schedule').select('*').eq('topic_id', topicId).maybeSingle()

    if (activity === 'exercises' && pct !== null) {
      const quality = getExerciseQuality(pct)
      const { sm2 } = await import('@/lib/sm2')
      const result = sm2(quality, existing?.repetitions ?? 0, existing?.ease_factor ?? 2.5, existing?.interval_days ?? 0)
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
            <button onClick={onClose} className="mt-0.5" style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>O que você estudou agora?</p>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {ACTIVITIES.map(a => {
              const Icon = a.Icon
              const active = activity === a.type
              return (
                <button
                  key={a.type}
                  onClick={() => setActivity(a.type)}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-all"
                  style={{
                    background: active ? 'var(--primary-soft)' : 'var(--surface-hover)',
                    borderColor: active ? 'var(--primary)' : 'var(--border)',
                  }}
                >
                  <Icon size={20} strokeWidth={1.75} style={{ color: active ? 'var(--primary)' : 'var(--text-muted)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: active ? 'var(--primary-soft-text)' : 'var(--text)' }}>{a.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>{a.desc}</p>
                  </div>
                </button>
              )
            })}
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
                  <label className="text-xs mb-1 inline-flex items-center gap-1" style={{ color: 'var(--success)' }}><Check size={11} strokeWidth={2.5} /> Acertos</label>
                  <input type="number" min="0" max={total || undefined} placeholder="40" value={correct} onChange={e => setCorrect(e.target.value)} className="w-full" style={{ textAlign: 'center' }} />
                </div>
                <div>
                  <label className="text-xs mb-1 inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}><X size={11} strokeWidth={2.5} /> Erros</label>
                  <div className="w-full rounded-lg px-3 py-2 text-center text-sm font-medium" style={{ background: 'var(--surface)', color: wrongNum > 0 ? 'var(--danger)' : 'var(--text-subtle)', border: '1px solid var(--border)' }}>
                    {totalNum > 0 ? wrongNum : '—'}
                  </div>
                </div>
              </div>

              {pct !== null && totalNum > 0 && (
                <div
                  className="rounded-xl p-3 flex items-center justify-between"
                  style={{ background: needsRevision ? 'var(--danger-soft)' : 'var(--success-soft)', border: `1px solid ${needsRevision ? 'var(--danger)' : 'var(--success)'}` }}
                >
                  <div>
                    <p className="text-2xl font-bold" style={{ color: needsRevision ? 'var(--danger)' : 'var(--success)' }}>{pct}%</p>
                    <p className="text-xs mt-0.5 inline-flex items-center gap-1" style={{ color: needsRevision ? 'var(--danger)' : 'var(--success)' }}>
                      {needsRevision ? <>⚠ Abaixo de {EXERCISE_THRESHOLD}% — revisão agendada</> : <><Check size={11} strokeWidth={2.5} /> Aprovado! Acima de {EXERCISE_THRESHOLD}%</>}
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
