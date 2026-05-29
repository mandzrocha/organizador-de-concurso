import { ActivityType, StudyLog, Topic, TopicProgress } from './types'

const ALL_ACTIVITIES: ActivityType[] = ['video', 'exercises', 'reading', 'review']

export function getTopicProgress(topic: Topic, logs: StudyLog[]): TopicProgress {
  const topicLogs = logs.filter(l => l.topic_id === topic.id)
  const completedActivities = [...new Set(topicLogs.map(l => l.activity_type))] as ActivityType[]

  return {
    topic,
    logs: topicLogs,
    completedActivities,
    nextReview: null,
  }
}

export function isTopicComplete(completedActivities: ActivityType[]): boolean {
  return ALL_ACTIVITIES.every(a => completedActivities.includes(a))
}

export function getTopicCompletionPercent(completedActivities: ActivityType[]): number {
  return Math.round((completedActivities.length / ALL_ACTIVITIES.length) * 100)
}

export function getSubjectCompletionPercent(topics: TopicProgress[]): number {
  if (topics.length === 0) return 0
  const total = topics.reduce((sum, t) => sum + getTopicCompletionPercent(t.completedActivities), 0)
  return Math.round(total / topics.length)
}
