export type ActivityType = 'video' | 'exercises' | 'reading' | 'review'
export type PlanStatus = 'planned' | 'done' | 'skipped'

export interface Exam {
  id: string
  name: string
  organization: string | null
  exam_date: string | null
  is_primary: boolean
  is_watching: boolean
  edital_url: string | null
  description: string | null
  uf: string | null          // sigla do estado (ex.: SP); null = nacional
  category: string | null    // categoria/área (ver EXAM_CATEGORIES)
  created_at: string
  updated_at: string
}

// Categorias/áreas dos concursos (usadas nos filtros da Biblioteca)
export const EXAM_CATEGORIES: { key: string; label: string }[] = [
  { key: 'federal',     label: 'Federais' },
  { key: 'militar',     label: 'Militar' },
  { key: 'tribunais',   label: 'Tribunais' },
  { key: 'fiscal',      label: 'Fiscal' },
  { key: 'controle',    label: 'Controle' },
  { key: 'bancario',    label: 'Bancos e estatais' },
  { key: 'seguranca',   label: 'Segurança' },
  { key: 'agencias',    label: 'Agências' },
  { key: 'legislativo', label: 'Legislativo' },
  { key: 'transito',    label: 'Trânsito' },
  { key: 'municipal',   label: 'Municipal' },
]

export const EXAM_CATEGORY_LABELS: Record<string, string> =
  Object.fromEntries(EXAM_CATEGORIES.map(c => [c.key, c.label]))

// Estados (UF -> nome) para filtros e seed
export const UF_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
}

export interface Subject {
  id: string
  name: string
  description: string | null
  color: string
  created_at: string
}

export interface ExamSubject {
  id: string
  exam_id: string
  subject_id: string
  weight: number
  order_index: number
  completed_at: string | null
  created_at: string
  subject?: Subject
  exam?: Exam
}

export interface Topic {
  id: string
  subject_id: string
  exam_id: string | null
  name: string
  order_index: number
  completed_at: string | null
  created_at: string
  subject?: Subject
  exam?: Exam
}

export interface StudyLog {
  id: string
  topic_id: string
  activity_type: ActivityType
  studied_at: string
  notes: string | null
  duration_minutes: number | null
  total_questions: number | null
  correct_answers: number | null
  created_at: string
  topic?: Topic
}

export interface RevisionSchedule {
  id: string
  topic_id: string
  next_review: string | null
  interval_days: number
  ease_factor: number
  repetitions: number
  last_reviewed: string | null
  created_at: string
  updated_at: string
  topic?: Topic
}

export interface CalendarPlan {
  id: string
  planned_date: string
  topic_id: string | null
  subject_id: string | null
  activity_type: ActivityType
  status: PlanStatus
  original_date: string | null
  notes: string | null
  order_index: number
  created_at: string
  updated_at: string
  topic?: (Topic & { subject?: Subject }) | null
  subject?: Subject | null
}

export interface UserGoals {
  user_id: string
  weekly_minutes: number | null
  weekly_questions: number | null
  weekly_topics: number | null
  weekly_days: number | null
  updated_at: string
}

export interface MockExam {
  id: string
  user_id: string
  exam_id: string | null
  title: string
  banca: string | null
  taken_at: string
  total_questions: number
  correct_answers: number
  duration_minutes: number | null
  notes: string | null
  created_at: string
  exam?: Exam | null
}

export interface ErrorNote {
  id: string
  user_id: string
  subject_id: string | null
  topic_id: string | null
  content: string
  resolved: boolean
  created_at: string
  subject?: Subject | null
  topic?: (Topic & { subject?: Subject }) | null
}

export interface TopicProgress {
  topic: Topic
  logs: StudyLog[]
  completedActivities: ActivityType[]
  nextReview: string | null
}

export interface SubjectProgress {
  subject: Subject
  topics: TopicProgress[]
  completedTopics: number
  totalTopics: number
  percentComplete: number
}

export interface ExamProgress {
  exam: Exam
  subjects: SubjectProgress[]
  percentComplete: number
  totalTopics: number
  completedTopics: number
}

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  video: 'Videoaula',
  exercises: 'Exercícios',
  reading: 'Leitura',
  review: 'Revisão',
}

export const ACTIVITY_ICONS: Record<ActivityType, string> = {
  video: '🎬',
  exercises: '✏️',
  reading: '📖',
  review: '🔁',
}

export const SUBJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6',
]
