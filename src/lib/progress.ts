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

export function isTopicComplete(topic: Pick<Topic, 'completed_at'> | null, completedActivities: ActivityType[]): boolean {
  if (topic?.completed_at) return true
  return ALL_ACTIVITIES.every(a => completedActivities.includes(a))
}

/**
 * Returns 100 if the topic is manually marked complete, otherwise the
 * percentage of the 4 activity types that have at least one log.
 */
export function getTopicCompletionPercent(
  completedActivities: ActivityType[],
  topicCompletedAt?: string | null,
): number {
  if (topicCompletedAt) return 100
  return Math.round((completedActivities.length / ALL_ACTIVITIES.length) * 100)
}

export function getSubjectCompletionPercent(topics: TopicProgress[]): number {
  if (topics.length === 0) return 0
  const total = topics.reduce(
    (sum, t) => sum + getTopicCompletionPercent(t.completedActivities, t.topic.completed_at),
    0,
  )
  return Math.round(total / topics.length)
}
