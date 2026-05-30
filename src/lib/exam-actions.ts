import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Deletes a exam together with all its dependent data:
 * - topics that belong only to this exam (exam_id = examId)
 *   plus their study_logs, revision_schedule and calendar_plans
 * - exam_subjects links
 * - calendar plans tied to subjects of this exam (subject-level plans)
 * Subjects themselves are NOT deleted because they can be shared between exams.
 *
 * Throws on first error.
 */
export async function deleteExamCascade(supabase: SupabaseClient, examId: string) {
  // 1. Find topics owned by this exam
  const { data: ownTopics, error: tErr } = await supabase
    .from('topics')
    .select('id')
    .eq('exam_id', examId)
  if (tErr) throw tErr
  const topicIds = (ownTopics || []).map((t: any) => t.id)

  // 2. Delete dependent rows for those topics
  if (topicIds.length > 0) {
    const errs = await Promise.all([
      supabase.from('calendar_plans').delete().in('topic_id', topicIds),
      supabase.from('revision_schedule').delete().in('topic_id', topicIds),
      supabase.from('study_logs').delete().in('topic_id', topicIds),
    ])
    for (const r of errs) if (r.error) throw r.error
    const { error: delTopicsErr } = await supabase.from('topics').delete().eq('exam_id', examId)
    if (delTopicsErr) throw delTopicsErr
  }

  // 3. Delete subject-level calendar plans for subjects linked to this exam
  const { data: subRows } = await supabase
    .from('exam_subjects')
    .select('subject_id')
    .eq('exam_id', examId)
  const subjectIds = (subRows || []).map((s: any) => s.subject_id)
  if (subjectIds.length > 0) {
    await supabase
      .from('calendar_plans')
      .delete()
      .is('topic_id', null)
      .in('subject_id', subjectIds)
  }

  // 4. Delete exam_subjects links (subjects remain — they can be shared)
  const { error: esErr } = await supabase.from('exam_subjects').delete().eq('exam_id', examId)
  if (esErr) throw esErr

  // 5. Finally delete the exam itself
  const { error: examErr } = await supabase.from('exams').delete().eq('id', examId)
  if (examErr) throw examErr
}
