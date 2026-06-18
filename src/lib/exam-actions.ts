import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Inscreve o usuário num concurso do catálogo compartilhado (cria/atualiza a
 * linha em user_exams). Se for marcado como foco principal, tira o foco dos
 * outros concursos do usuário antes.
 */
export async function enrollUser(
  supabase: SupabaseClient,
  examId: string,
  userId: string,
  opts: { isPrimary?: boolean; isWatching?: boolean } = {},
) {
  const isWatching = !!opts.isWatching
  const isPrimary = isWatching ? false : !!opts.isPrimary
  if (isPrimary) {
    await supabase.from('user_exams').update({ is_primary: false }).eq('user_id', userId)
  }
  const { error } = await supabase.from('user_exams').upsert(
    { user_id: userId, exam_id: examId, is_primary: isPrimary, is_watching: isWatching },
    { onConflict: 'user_id,exam_id' },
  )
  if (error) throw error
}

/**
 * Multiusuário: "excluir um concurso" = DESINSCREVER o usuário.
 * Remove só os dados PESSOAIS dele (logs, revisões, planos, progresso e a
 * matrícula). O catálogo compartilhado (exam, subjects, topics) permanece,
 * pois outros usuários podem estar usando.
 */
export async function unenrollExam(supabase: SupabaseClient, examId: string, userId: string) {
  const { data: topics } = await supabase.from('topics').select('id').eq('exam_id', examId)
  const topicIds = (topics || []).map((t: any) => t.id)

  const { data: es } = await supabase.from('exam_subjects').select('id, subject_id').eq('exam_id', examId)
  const esIds = (es || []).map((e: any) => e.id)
  const subjectIds = (es || []).map((e: any) => e.subject_id)

  if (topicIds.length > 0) {
    const errs = await Promise.all([
      supabase.from('study_logs').delete().eq('user_id', userId).in('topic_id', topicIds),
      supabase.from('revision_schedule').delete().eq('user_id', userId).in('topic_id', topicIds),
      supabase.from('calendar_plans').delete().eq('user_id', userId).in('topic_id', topicIds),
      supabase.from('user_topic_progress').delete().eq('user_id', userId).in('topic_id', topicIds),
    ])
    for (const r of errs) if (r.error) throw r.error
  }
  if (subjectIds.length > 0) {
    await supabase.from('calendar_plans').delete().eq('user_id', userId).is('topic_id', null).in('subject_id', subjectIds)
  }
  if (esIds.length > 0) {
    await supabase.from('user_subject_progress').delete().eq('user_id', userId).in('exam_subject_id', esIds)
  }
  const { error } = await supabase.from('user_exams').delete().eq('user_id', userId).eq('exam_id', examId)
  if (error) throw error
}

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
